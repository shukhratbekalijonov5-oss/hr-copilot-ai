import { NotificationsListener } from './notifications.listener';
import { DomainEventsService } from '../common/events/domain-events.service';
import { toMessagePreview } from './notification-view';
import {
  ApplicationStatus,
  ConversationParty,
} from '../generated/prisma/enums';

const ORG = 'org-a';
/** Vacancy creator (Alice). */
const ALICE = 'hr-alice';
/** Candidate account owner (John). */
const JOHN_USER = 'user-john';

function createPrismaMock() {
  return {
    vacancy: {
      findUnique: jest.fn().mockResolvedValue({
        createdById: ALICE,
        title: 'Backend Engineer',
      }),
    },
    candidate: {
      findUnique: jest.fn().mockResolvedValue({ fullName: 'John Kim' }),
    },
    candidateAccount: {
      findUnique: jest.fn().mockResolvedValue({ userId: JOHN_USER }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ fullName: 'Alice Park' }),
    },
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        organizationId: ORG,
        vacancy: { id: 'v1', title: 'Backend Engineer', createdById: ALICE },
        candidate: { id: 'c1', fullName: 'John Kim' },
        candidateAccount: { userId: JOHN_USER },
      }),
    },
    document: {
      findUnique: jest.fn().mockResolvedValue({
        uploadedById: ALICE,
        originalFileName: 'john.pdf',
        candidate: { id: 'c1', fullName: 'John Kim' },
      }),
    },
  };
}

const message = (party: ConversationParty, sender: string, name: string) => ({
  conversationId: 'conv-1',
  senderUserId: sender,
  message: {
    id: 'm1',
    conversationId: 'conv-1',
    senderParty: party,
    senderName: name,
    content: 'Hello, I have a question about the interview.',
    createdAt: new Date(),
  },
});

describe('NotificationsListener', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let events: DomainEventsService;
  let notifications: { create: jest.Mock; exists: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    // The REAL bus: publishers and the listener meet exactly as in prod.
    events = new DomainEventsService();
    notifications = {
      create: jest.fn().mockResolvedValue({ id: 'n1' }),
      exists: jest.fn().mockResolvedValue(false),
    };
    new NotificationsListener(
      prisma as never,
      events,
      notifications as never,
    ).onModuleInit();
  });

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  describe('NEW_APPLICATION (HR)', () => {
    const applied = () => ({
      organizationId: ORG,
      vacancyId: 'v1',
      applicationId: 'a1',
      candidateId: 'c1',
    });

    it('an application notifies the vacancy CREATOR with names', async () => {
      events.publish('application.created', applied());
      await flush();

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NEW_APPLICATION',
          audience: 'HR',
          recipientUserId: ALICE,
          organizationId: ORG,
          vacancyTitleSnapshot: 'Backend Engineer',
          candidateNameSnapshot: 'John Kim',
        }),
      );
      expect(notifications.create).toHaveBeenCalledTimes(1); // never the org
    });
  });

  describe('NEW_MESSAGE — always the OTHER side, never the sender', () => {
    it('candidate → HR notifies the vacancy creator with candidate name, vacancy and preview', async () => {
      events.publish(
        'chat.message.created',
        message(ConversationParty.CANDIDATE, JOHN_USER, 'John Kim'),
      );
      await flush();

      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NEW_MESSAGE',
          audience: 'HR',
          recipientUserId: ALICE,
          candidateNameSnapshot: 'John Kim',
          vacancyTitleSnapshot: 'Backend Engineer',
          messagePreview: 'Hello, I have a question about the interview.',
          conversationId: 'conv-1',
          messageId: 'm1',
        }),
      );
    });

    it('HR → candidate notifies the candidate account owner with HR name', async () => {
      events.publish(
        'chat.message.created',
        message(ConversationParty.ORGANIZATION, ALICE, 'Alice Park'),
      );
      await flush();

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NEW_MESSAGE',
          audience: 'CANDIDATE',
          recipientUserId: JOHN_USER,
          actorNameSnapshot: 'Alice Park',
          vacancyTitleSnapshot: 'Backend Engineer',
        }),
      );
      // Candidate rows are personal — no organization scoping.
      expect(
        notifications.create.mock.calls[0][0].organizationId,
      ).toBeUndefined();
    });

    it('a conversation deleted mid-flight notifies nobody', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);
      events.publish(
        'chat.message.created',
        message(ConversationParty.CANDIDATE, JOHN_USER, 'John Kim'),
      );
      await flush();
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('INTERVIEW_INVITATION (candidate)', () => {
    const invited = (
      previousStatus: ApplicationStatus,
      candidateAccountId = 'acct-1',
    ) => ({
      organizationId: ORG,
      vacancyId: 'v1',
      applicationId: 'a1',
      candidateId: 'c1',
      candidateAccountId,
      conversationId: 'conv-1',
      actorUserId: ALICE,
      previousStatus,
    });

    it('a genuine transition notifies the candidate with the HR name', async () => {
      events.publish('interview.invited', invited(ApplicationStatus.NEW));
      await flush();

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'INTERVIEW_INVITATION',
          audience: 'CANDIDATE',
          recipientUserId: JOHN_USER,
          actorNameSnapshot: 'Alice Park',
          vacancyTitleSnapshot: 'Backend Engineer',
          conversationId: 'conv-1',
        }),
      );
    });

    it('a re-invite (INTERVIEW → INTERVIEW) is silent', async () => {
      events.publish('interview.invited', invited(ApplicationStatus.INTERVIEW));
      await flush();
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('APPLICATION_REJECTED (candidate)', () => {
    const rejected = (previousStatus: ApplicationStatus) => ({
      organizationId: ORG,
      vacancyId: 'v1',
      applicationId: 'a1',
      candidateId: 'c1',
      candidateAccountId: 'acct-1',
      deletedConversationId: null,
      previousStatus,
    });

    it('a genuine transition notifies the candidate with the vacancy name', async () => {
      events.publish(
        'application.rejected',
        rejected(ApplicationStatus.REVIEWING),
      );
      await flush();

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'APPLICATION_REJECTED',
          audience: 'CANDIDATE',
          recipientUserId: JOHN_USER,
          vacancyTitleSnapshot: 'Backend Engineer',
        }),
      );
    });

    it('REJECTED → REJECTED is silent (no duplicate)', async () => {
      events.publish(
        'application.rejected',
        rejected(ApplicationStatus.REJECTED),
      );
      await flush();
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('VACANCY_DELETED (candidates)', () => {
    it('every recipient gets one notification carrying the TITLE SNAPSHOT', async () => {
      events.publish('vacancy.deleted', {
        organizationId: ORG,
        vacancyId: 'v-gone',
        vacancyTitle: 'Backend Engineer',
        actorUserId: ALICE,
        recipients: [
          { userId: 'user-a', candidateId: 'c-a' },
          { userId: 'user-b', candidateId: 'c-b' },
        ],
      });
      await flush();

      expect(notifications.create).toHaveBeenCalledTimes(2);
      for (const userId of ['user-a', 'user-b']) {
        expect(notifications.create).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'VACANCY_DELETED',
            audience: 'CANDIDATE',
            recipientUserId: userId,
            vacancyId: 'v-gone',
            // The row is gone — the snapshot is the only surviving title.
            vacancyTitleSnapshot: 'Backend Engineer',
          }),
        );
      }
      // No live-vacancy lookup: the row no longer exists to look up.
      expect(prisma.vacancy.findUnique).not.toHaveBeenCalled();
    });
  });
});

describe('toMessagePreview', () => {
  it('collapses whitespace and clips to 120 chars with an ellipsis', () => {
    const long = `line one\nline two   ${'x'.repeat(200)}`;
    const preview = toMessagePreview(long);
    expect(preview).toHaveLength(120);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview).not.toContain('\n');
  });

  it('leaves short messages intact', () => {
    expect(toMessagePreview('Hello there')).toBe('Hello there');
  });
});
