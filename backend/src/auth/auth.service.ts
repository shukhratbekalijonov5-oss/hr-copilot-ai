import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../generated/prisma/enums';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../common/interfaces/authenticated-user.interface';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { InviteUserDto } from './dto/invite-user.dto';

export interface AuthTokenResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    organizationId: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** Creates an organization and its OWNER in a single transaction. */
  async register(dto: RegisterDto): Promise<AuthTokenResponse> {
    const email = normaliseEmail(dto.email);

    const [existingUser, existingOrg] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.prisma.organization.findUnique({ where: { slug: dto.organizationSlug } }),
    ]);
    if (existingUser) throw new ConflictException('Email is already registered');
    if (existingOrg) throw new ConflictException('Organization slug is already taken');

    const passwordHash = await this.hashPassword(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: dto.organizationName, slug: dto.organizationSlug },
      });
      return tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName,
          role: Role.OWNER,
          organizationId: organization.id,
        },
      });
    });

    return this.buildTokenResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthTokenResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: normaliseEmail(dto.email) },
    });

    // Compare against a dummy hash when the user is absent so that response
    // timing does not reveal whether the address exists.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const matches = await bcrypt.compare(dto.password, hash);

    if (!user || !matches) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.buildTokenResponse(user);
  }

  /**
   * Adds a user to the *caller's* organization. organizationId comes from the
   * authenticated actor, never from the request body.
   */
  async inviteUser(organizationId: string, dto: InviteUserDto) {
    const email = normaliseEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email is already registered');

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await this.hashPassword(dto.password),
        fullName: dto.fullName,
        role: dto.role,
        organizationId,
      },
    });
    return toPublicUser(user);
  }

  /** Re-reads the user so a revoked/edited account cannot ride an old token. */
  async currentUser(actor: AuthenticatedUser) {
    const user = await this.prisma.user.findFirst({
      where: { id: actor.id, organizationId: actor.organizationId },
      include: { organization: { select: { id: true, name: true, slug: true } } },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');

    return { ...toPublicUser(user), organization: user.organization };
  }

  private hashPassword(plain: string): Promise<string> {
    const rounds = this.configService.get<number>('auth.bcryptRounds', 12);
    return bcrypt.hash(plain, rounds);
  }

  private async buildTokenResponse(user: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    organizationId: string;
  }): Promise<AuthTokenResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      org: user.organizationId,
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('auth.secretToken'),
      // jsonwebtoken types this as `number | ms.StringValue`; the value is a
      // validated config string such as '1d', so narrow it at the boundary.
      expiresIn: this.configService.get<string>(
        'auth.tokenTtl',
        '1d',
      ) as JwtSignOptions['expiresIn'],
    });
    return { accessToken, user: toPublicUser(user) };
  }
}

/** bcrypt hash of a value no user can supply. Used only for timing parity. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7jkQ3q1nXKGGCXQzGQ2Q0kQfV0k9Zzy';

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/** Strips passwordHash — this shape is what leaves the process. */
function toPublicUser<
  T extends {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    organizationId: string;
  },
>(user: T) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organizationId: user.organizationId,
  };
}
