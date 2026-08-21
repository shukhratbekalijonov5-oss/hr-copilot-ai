/**
 * Russian UI strings.
 *
 * Russian has four plural categories (one / few / many / other), and every
 * plural record below fills all of them — `Intl.PluralRules` picks between
 * «1 кандидат», «2 кандидата» and «5 кандидатов» rather than a naive
 * count === 1 check.
 *
 * Tone is professional B2B: neutral «вы», noun phrases for labels.
 */
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Plural } from "@/lib/i18n/dictionaries/en";

const ru: Dictionary = {
  meta: {
    appName: "HR Copilot AI",
    tagline: "Аналитика для найма",
    description:
      "Подбор на основе фактов: ищите по резюме обычным языком, отслеживайте каждое утверждение до источника, а решения о найме оставляйте людям.",
  },

  datetime: {
    months: [
      "янв.", "февр.", "мар.", "апр.", "мая", "июн.",
      "июл.", "авг.", "сент.", "окт.", "нояб.", "дек.",
    ],
    date: "{day} {month} {year} г.",
    dateTime: "{day} {month}, {time}",
    time: "{hour}:{minute}",
    justNow: "только что",
    minutesAgo: {
      one: "{count} минуту назад",
      few: "{count} минуты назад",
      many: "{count} минут назад",
      other: "{count} минуты назад",
    },
    hoursAgo: {
      one: "{count} час назад",
      few: "{count} часа назад",
      many: "{count} часов назад",
      other: "{count} часа назад",
    },
    daysAgo: {
      one: "{count} день назад",
      few: "{count} дня назад",
      many: "{count} дней назад",
      other: "{count} дня назад",
    },
    groupSeparator: "\u00A0",
    decimalSeparator: ",",
  },

  common: {
    save: "Сохранить изменения",
    saved: "Сохранено",
    cancel: "Отмена",
    edit: "Изменить",
    close: "Закрыть",
    retry: "Повторить",
    search: "Поиск",
    filter: "Фильтр",
    clear: "Сбросить",
    viewAll: "Показать все",
    back: "Назад",
    next: "Далее",
    previous: "Назад",
    open: "Открыть",
    loading: "Загрузка",
    notRecorded: "Не указано",
    notSet: "Должность не указана",
    none: "Нет",
    page: "страница",
    showMore: "Показать полностью",
    showLess: "Свернуть",
    pageOf: "{page} / {total}",
    pageNumber: "Страница {page}",
    language: "Язык",
    changeLanguage: "Сменить язык",
    humanDecision: "Решение принимает человек",
    of: "{count} из {total}",
    years: {
      one: "{count} год",
      few: "{count} года",
      many: "{count} лет",
      other: "{count} года",
    },
    candidates: {
      one: "{count} кандидат",
      few: "{count} кандидата",
      many: "{count} кандидатов",
      other: "{count} кандидата",
    },
    files: {
      one: "{count} файл",
      few: "{count} файла",
      many: "{count} файлов",
      other: "{count} файла",
    },
    documents: {
      one: "{count} документ",
      few: "{count} документа",
      many: "{count} документов",
      other: "{count} документа",
    },
    passages: {
      one: "{count} совпадающий фрагмент",
      few: "{count} совпадающих фрагмента",
      many: "{count} совпадающих фрагментов",
      other: "{count} совпадающих фрагмента",
    },
  },

  nav: {
    sectionWorkspace: "Рабочее пространство",
    sectionJobSearch: "Поиск работы",
    dashboard: "Обзор",
    vacancies: "Вакансии",
    candidates: "Кандидаты",
    aiSearch: "AI-поиск",
    compare: "Сравнение",
    processing: "Обработка",
    settings: "Настройки",
    findJobs: "Найти работу",
    aiJobMatch: "AI-подбор вакансий",
    myApplications: "Мои отклики",
    interviewChats: "Интервью-чаты",
    savedJobs: "Сохранённые вакансии",
    myProfile: "Мой профиль",
    openNavigation: "Открыть меню",
    closeNavigation: "Закрыть меню",
    breadcrumb: "Навигационная цепочка",
    notePersonal:
      "Ваш профиль и отклики принадлежат вам. Рекрутеры видят только то, что вы отправили.",
    noteOrganization:
      "Отбор и отказ остаются решением человека. Копилот лишь показывает подтверждения.",
    profile: "Профиль",
    workspaceSettings: "Настройки пространства",
    signOut: "Выйти",
    notifications: "Уведомления",
    notificationsUnavailable: "Уведомления пока недоступны",
    personal: "Личное",
    organizations: "Организации",
    personalUnavailable:
      "Профили соискателей пока недоступны — в API нет учётной записи кандидата для входа.",
    multiOrganizationNote:
      "Членство в нескольких организациях требует модели, которой в API пока нет.",
    oneOfOne: "1 из 1",
  },

  notifications: {
    title: "Уведомления",
    bellLabel: "Открыть уведомления",
    bellUnreadLabel: "Открыть уведомления, непрочитано: {count}",
    unread: "Непрочитано: {count}",
    allCaughtUp: "Всё прочитано",
    markAllRead: "Прочитать все",
    loadMore: "Загрузить ещё",
    noDestination: "Нет связанной страницы",
    empty: {
      hrTitle: "Нет рекрутинговых уведомлений",
      hrDescription:
        "Отклики, сообщения кандидатов и обновления обработки CV появятся здесь.",
      candidateTitle: "Нет уведомлений",
      candidateDescription:
        "Сообщения, приглашения на интервью и обновления откликов появятся здесь.",
    },
    errors: {
      load: "Не удалось загрузить уведомления.",
      markRead: "Не удалось отметить уведомление прочитанным.",
      markAll: "Не удалось отметить уведомления прочитанными.",
    },
    fallbacks: {
      candidateUnavailable: "Кандидат недоступен",
      vacancyUnavailable: "Вакансия недоступна",
      recruiter: "Рекрутер",
    },
    messages: {
      newMessageFallback: "Новое сообщение",
      interviewInvitation: "Вас пригласили на интервью.",
      vacancyDeleted: "ÐÐ°ÐºÐ°Ð½ÑÐ¸Ñ «{vacancy}», Ð½Ð° ÐºÐ¾ÑÐ¾ÑÑÑ Ð²Ñ Ð¾ÑÐºÐ»Ð¸ÐºÐ½ÑÐ»Ð¸ÑÑ, Ð±ÑÐ»Ð° ÑÐ´Ð°Ð»ÐµÐ½Ð°.",
      applicationRejected: "Команда решила не продолжать процесс.",
    },
    types: {
      NEW_APPLICATION: "Новый отклик",
      NEW_MESSAGE: "Новое сообщение",
      INTERVIEW_INVITATION: "Приглашение на интервью",
      VACANCY_DELETED: "ÐÐ±Ð½Ð¾Ð²Ð»ÐµÐ½Ð¸Ðµ Ð²Ð°ÐºÐ°Ð½ÑÐ¸Ð¸",
      APPLICATION_REJECTED: "Обновление отклика",
    },
  },

  auth: {
    candidate: "Кандидат",
    organization: "Организация",
    chooseSignIn: "Выберите способ входа",
    chooseRegistration: "Выберите тип аккаунта",
    chooseAccountTypeHint:
      "Аккаунты кандидатов и организаций разделены. Выберите вход для своего типа аккаунта.",
    candidateAuthHint:
      "Ищите вакансии, управляйте откликами, сохраняйте вакансии и используйте AI-подбор.",
    organizationAuthHint:
      "Управляйте вакансиями, кандидатами, поиском по подтверждениям и процессом найма.",
    accountTypeExclusive:
      "Один email может быть либо аккаунтом кандидата, либо организации — не обоими.",
    signIn: "Вход",
    candidateSignIn: "Вход для кандидата",
    organizationSignIn: "Вход для организации",
    signingIn: "Выполняется вход",
    signInSubtitle: "Войдите рабочей учётной записью, чтобы открыть воронку найма.",
    candidateSignInSubtitle:
      "Войдите как кандидат, чтобы искать работу и управлять откликами.",
    organizationSignInSubtitle:
      "Войдите как организация, чтобы управлять рабочими пространствами найма.",
    createAccount: "Создать пространство",
    createCandidateAccount: "Создать аккаунт кандидата",
    createOrganizationAccount: "Создать аккаунт организации",
    createAccountSubtitle: "Создайте организацию и станьте её первым администратором.",
    email: "Эл. почта",
    emailPlaceholder: "you@company.com",
    password: "Пароль",
    fullName: "Имя и фамилия",
    organizationName: "Название организации",
    organizationSlug: "Адрес пространства",
    showPassword: "Показать пароль",
    hidePassword: "Скрыть пароль",
    noAccount: "Ещё нет аккаунта?",
    createOne: "Создать",
    haveAccount: "Уже есть аккаунт?",
    signInInstead: "Войти",
    couldNotSignIn: "Не удалось войти.",
    couldNotRegister: "Не удалось создать пространство.",
    candidateAccountUseCandidateSignIn:
      "Это аккаунт кандидата. Войдите через вход для кандидата.",
    organizationAccountUseOrganizationSignIn:
      "Этот аккаунт принадлежит организации. Войдите через вход для организации.",
    emailAlreadyRegistered: "Этот email уже зарегистрирован. Войдите вместо регистрации.",
    emailBelongsToCandidate: "Этот email уже зарегистрирован как аккаунт кандидата.",
    emailBelongsToOrganization:
      "Этот email уже зарегистрирован как аккаунт организации.",
    creating: "Создание",
    heroTitle: "Прочитайте каждое резюме как следует — не читая каждое резюме.",
    heroPoints: [
      "Каждое извлечённое утверждение ведёт к странице, откуда оно взято.",
      "Ищите по резюме обычным языком сразу по всей воронке.",
      "Отбор и отказ всегда остаются решением человека.",
    ],
  },

  validation: {
    emailRequired: "Укажите адрес эл. почты.",
    workEmailRequired: "Укажите рабочий адрес эл. почты.",
    emailInvalid: "Введите корректный адрес эл. почты.",
    passwordRequired: "Введите пароль.",
    passwordMinLength: "Используйте не менее {min} символов.",
    fullNameRequired: "Укажите имя и фамилию.",
    fullNameShort: "Введите имя и фамилию полностью.",
    organizationNameRequired: "Укажите название компании или организации.",
    slugRequired: "Укажите адрес пространства.",
    slugPattern: "Используйте только строчные латинские буквы, цифры и дефисы.",
    emailInUse: "Этот адрес электронной почты уже используется.",
    websiteUrlInvalid: "Введите корректный URL, начинающийся с http:// или https://.",
  },

  register: {
    subtitle: "Создаёт вашу организацию и делает вас её владельцем.",
    candidateSubtitle:
      "Создайте аккаунт соискателя. Компания и пространство не нужны.",
    organizationSubtitle: "Создаёт вашу организацию и делает вас её владельцем.",
    fullNamePlaceholder: "Иван Петров",
    workEmail: "Рабочая почта",
    workEmailPlaceholder: "ivan@company.com",
    organizationLabel: "Компания или организация",
    organizationPlaceholder: "Northwind Talent",
    slugLabel: "Адрес пространства",
    slugPlaceholder: "northwind-talent",
    slugHint: "Строчные буквы, цифры и дефисы. Должен быть уникальным.",
    preferredLanguage: "Предпочитаемый язык",
    passwordPlaceholder: "Не менее {min} символов",
    passwordHint: "Не менее {min} символов.",
    submit: "Создать пространство",
    submitCandidate: "Создать аккаунт кандидата",
    submitOrganization: "Создать аккаунт организации",
    submitting: "Создаём пространство",
    submittingCandidate: "Создаём аккаунт кандидата",
    submittingOrganization: "Создаём аккаунт организации",
  },

  dashboard: {
    title: "Обзор",
    description: "Текущее состояние вашей воронки найма.",
    newVacancy: "Новая вакансия",
    statTotalCandidates: "Всего кандидатов",
    statTotalCandidatesHint: "По всем вакансиям этого пространства",
    statActiveVacancies: "Активные вакансии",
    statActiveVacanciesHint: "Открыты и принимают кандидатов",
    statResumesProcessing: "Резюме в обработке",
    statResumesProcessingHint: "В конвейере разбор → индексация",
    statCompletedAnalyses: "Анализ завершён",
    statCompletedAnalysesHint: "Документы проиндексированы и готовы к чтению",
    quickCreateVacancy: "Создать вакансию",
    quickCreateVacancyHint: "Опишите требования, которые будет искать копилот.",
    quickReviewApplicants: "Отклики",
    quickReviewApplicantsHint: "Посмотрите, кто откликнулся на ваши вакансии.",
    recentVacancies: "Недавние вакансии",
    recentCandidates: "Недавние кандидаты",
    processingActivity: "Ход обработки",
    processingActivityHint: "Документы, дошедшие до каждого этапа",
    latestProcessing: "Последние задачи",
    latestProcessingHint: "Самые свежие задачи",
    openProcessingQueue: "Открыть очередь обработки",
    noVacancies: "Вакансий пока нет",
    noVacanciesHint: "Создайте первую вакансию, чтобы задать копилоту ориентиры.",
    noCandidates: "Откликов пока нет",
    noCandidatesHint:
      "Кандидаты, откликнувшиеся на ваши вакансии, появятся здесь.",
    nothingProcessed: "Пока ничего не обработано",
    nothingProcessedHint:
      "Загруженные документы появятся здесь по мере прохождения конвейера.",
    noDepartment: "Без отдела",
    noLocation: "Без локации",
    document: "Документ",
  },

  vacancies: {
    title: "Вакансии",
    description:
      "Все роли, на которые вы нанимаете, и требования, с которыми сверяется каждое резюме.",
    create: "Создать вакансию",
    createTitle: "Создание вакансии",
    createDescription:
      "С требованиями сверяется каждое резюме, поэтому формулируйте их так, как стали бы о них спрашивать.",
    searchPlaceholder: "Поиск вакансий",
    filterStatus: "Статус",
    filterDepartment: "Отдел",
    allStatuses: "Все статусы",
    allDepartments: "Все отделы",
    empty: "Вакансий пока нет",
    emptyHint: "Создайте первую вакансию, чтобы задать копилоту ориентиры.",
    noMatches: "Подходящих вакансий нет",
    noMatchesHint: "Снимите фильтр, чтобы увидеть больше ролей.",
    requirements: "Требования",
    requirement: "Требование",
    addRequirement: "Добавить требование",
    removeRequirement: "Удалить требование",
    noRequirements: "У этой вакансии пока нет требований",
    noRequirementsHint:
      "Добавьте требования — каждое будет сверяться с документами кандидатов.",
    fieldTitle: "Название должности",
    fieldDepartment: "Отдел",
    fieldLocation: "Локация",
    fieldEmploymentType: "Тип занятости",
    fieldExperienceLevel: "Уровень",
    fieldDescription: "Описание",
    requirementText: "Требование",
    requirementType: "Тип",
    requirementRequired: "Обязательно",
    candidatesOnVacancy: "Кандидаты",
    viewCandidates: "Посмотреть кандидатов",
    compareCandidates: "Сравнить кандидатов",
    notFound: "Вакансия не найдена",
    notFoundHint: "Такой вакансии нет или она принадлежит другой организации.",
    backToVacancies: "К списку вакансий",
  },

  candidates: {
    title: "Кандидаты",
    description:
      "Все, кто есть в вашей воронке, и состояние их документов. Модель никого не ранжирует и не отсеивает.",
    searchPlaceholder: "Поиск кандидатов",
    filterVacancy: "Вакансия",
    allVacancies: "Все вакансии",
    sortBy: "Сортировка",
    sortRecent: "Сначала новые",
    sortName: "По имени",
    sortExperience: "По опыту",
    empty: "Кандидатов пока нет",
    emptyHint: "Добавьте кандидата и загрузите резюме, чтобы наполнить воронку.",
    noMatches: "Подходящих кандидатов нет",
    noMatchesHint: "Снимите фильтр, чтобы увидеть больше людей.",
    overview: "О кандидате",
    currentTitle: "Текущая должность",
    experience: "Опыт",
    location: "Локация",
    email: "Эл. почта",
    phone: "Телефон",
    added: "Первый отклик",
    documents: "Документы",
    noDocumentsYet:
      "Пока ничего не прислано. Здесь появится резюме, которое кандидат приложил к отклику.",

    // Источники данных — файлы и профессиональные ссылки. Для HR только чтение.
    evidenceSources: "Источники данных",
    evidenceSourceCounts: "прислано файлов: {files} · ссылок: {links}",
    filesCount: {
      one: "Файл · {count}",
      few: "Файлы · {count}",
      many: "Файлы · {count}",
      other: "Файлы · {count}",
    } as Plural,
    linksCount: {
      one: "Профессиональная ссылка · {count}",
      few: "Профессиональные ссылки · {count}",
      many: "Профессиональные ссылки · {count}",
      other: "Профессиональные ссылки · {count}",
    } as Plural,
    noSource: "Источник не выбран",
    noSourceHint: "Выберите файл или ссылку, чтобы увидеть, что было прислано.",
    originalUrl: "Исходная ссылка",
    submittedContent: "Присланное содержимое",
    fetchedOn: "Прочитано {date}",
    pagesRead: {
      one: "прочитана {count} страница",
      few: "прочитано {count} страницы",
      many: "прочитано {count} страниц",
      other: "прочитано {count} страниц",
    } as Plural,
    snapshotNote:
      "Это содержимое на момент отклика. С тех пор страница могла измениться; анализ ниже основан на том, что было прислано.",
    sourceIndexingFailed:
      "Эту ссылку не удалось подготовить к анализу, поэтому она не участвует в ответах ИИ.",
    openOriginal: "Открыть оригинал",
    documentsUploaded: {
      one: "прислан {count} файл",
      few: "прислано {count} файла",
      many: "прислано {count} файлов",
      other: "загружено {count} файла",
    },
    applications: "Отклики",
    applicationsHint: "Смена этапа записывается вместе с тем, кто её сделал.",
    applicationStage: "Этап отклика",
    notAttached: "Не привязан к вакансии",
    notAttachedHint:
      "Привяжите кандидата к вакансии, чтобы сверить его документы с её требованиями.",
    appliedOn: "Отклик {date}",
    vacancy: "Вакансия",
    updateFailed: "Не удалось обновить.",
    couldNotUpdate: "Не удалось обновить отклик.",
    notFound: "Кандидат не найден",
    notFoundHint: "Такого кандидата нет или он принадлежит другой организации.",
    backToCandidates: "К списку кандидатов",
    fieldFullName: "Имя и фамилия",
    fieldEmail: "Эл. почта",
    fieldPhone: "Телефон",
    fieldLocation: "Локация",
    fieldCurrentTitle: "Текущая должность",
    fieldExperienceYears: "Лет опыта",
    tabOverview: "Обзор",
    tabEvidence: "Подтверждения",
    tabSummary: "AI-резюме",
    tabQuestions: "Вопросы к интервью",
    tabAsk: "Вопрос",
    noDocument: "Нет документа",
    noDocumentHint: "Загрузите резюме этого кандидата, чтобы прочитать его здесь.",
    selectDocument: "Выбрать документ",
    documentOpenFailed: "Не удалось открыть документ. Повторите позже.",
    previewUnavailable: "Не удалось показать PDF здесь.",
    openPdf: "Открыть PDF",
    docxNotRenderable:
      "Браузеры не умеют показывать DOCX внутри страницы. Откройте файл отдельно — извлечённый текст и ссылки на источники остаются рядом.",
    openFile: "Открыть {name}",
    showingCitation: "Показан источник",
    noDocuments: "Нет документов",
  },

  upload: {
    title: "Загрузка резюме",
    dropHere: "Перетащите резюме сюда",
    browse: "Выбрать файлы",
    hint: "PDF или DOCX, до {size}.",
    unsupportedType: "{name} — не файл PDF или DOCX.",
    tooLarge: "{name} больше, чем {size}.",
    uploading: "Загрузка",
    uploadFailed: "Загрузка не удалась",
    remove: "Удалить",
    unattachedNote:
      "Загруженные здесь файлы сохраняются без кандидата. Чтобы сверить их с требованиями вакансии, загружайте со страницы кандидата.",
    errorCodes: {
      FILE_TOO_LARGE: "Файл больше лимита 50 МБ.",
      UNSUPPORTED_FILE_TYPE: "Загрузите файл PDF или DOCX.",
      PERSONAL_DOCUMENT_LIMIT_REACHED:
        "Можно хранить до 3 документов. Удалите один, чтобы загрузить другой.",
    },
  },

  search: {
    title: "AI-поиск по кандидатам",
    description:
      "Спрашивайте обычным языком. К каждому результату прилагается исходный фрагмент с документом и страницей.",
    label: "Поиск по подтверждениям в резюме",
    placeholder:
      "Опишите, что вы ищете — например: эксплуатировал Kubernetes в проде и вёл дежурства",
    hint: "Enter — искать · Shift + Enter — новая строка",
    submit: "Искать",
    minLength: "Введите минимум два символа для поиска.",
    examples: [
      "Опыт эксплуатации Kubernetes в проде",
      "Redis Pub/Sub для рассылки событий",
      "Проектирование GraphQL-схемы для внутренних сервисов",
      "Руководил переходом с монолита на сервисы",
    ],
    resultsCount: {
      one: "{count} кандидат с совпадающими фрагментами",
      few: "{count} кандидата с совпадающими фрагментами",
      many: "{count} кандидатов с совпадающими фрагментами",
      other: "{count} кандидата с совпадающими фрагментами",
    },
    reranked: "Переранжировано",
    considered: "Рассмотрено: {count} · {ms} мс",
    noResults: "Подтверждающих фрагментов не найдено",
    noResultsHint:
      "В проиндексированных документах нет ничего подходящего. Попробуйте другую формулировку или проверьте, что резюме уже обработаны.",
    unavailable: "Поиск временно недоступен",
    unavailableHint:
      "Сервис поиска сейчас недоступен, поэтому показать результаты нельзя. Это не то же самое, что «ничего не найдено» — повторите позже.",
    failed: "Поиск не удался. Повторите позже.",
    orderingNote:
      "Кандидаты идут в порядке своего самого точного совпадения. Это отражает близость текста к запросу, а не оценку человека и не рекомендацию по найму.",
    retrievalContext: "Контекст поиска",
    unnamedCandidate: "Кандидат без имени",
    sourceDocument: "Исходный документ",
    sourceLink: "Профессиональная ссылка",
    summaryTitle: "AI-сводка",
    searchingEvidence: "Ищем подтверждения по кандидатам…",
    generatingSummary: "Составляем обоснованную сводку…",
  },

  ai: {
    ask: "Задать вопрос об этом кандидате",
    askDescription:
      "Ответ составляется только по фрагментам загруженных документов, и к каждому прилагается источник.",
    askPlaceholder:
      "Задайте вопрос по документам кандидата — например: за что он отвечал на прошлом месте?",
    askLabel: "Вопрос с опорой на подтверждения",
    askSubmit: "Спросить",
    generating: "Генерация",
    generatingAnswer: "Читаем документы и составляем ответ…",
    answer: "Ответ",
    answerLocale: "Язык ответа",
    citations: "Источники",
    citationsCount: {
      one: "{count} источник",
      few: "{count} источника",
      many: "{count} источников",
      other: "{count} источника",
    },
    noCitations: "Вместе с этим ответом не вернулось ни одного исходного фрагмента.",
    supportingEvidence: "Подтверждающий фрагмент",
    viewOriginalEvidence: "Показать исходный фрагмент",
    hideOriginalEvidence: "Скрыть исходный фрагмент",
    sectionLabels: {
      summary: "О себе",
      experience: "Опыт работы",
      projects: "Проекты",
      skills: "Навыки",
      education: "Образование",
      certifications: "Сертификаты",
      languages: "Языки",
    },
    citationSourcesUnavailable:
      "В ответе есть ссылки на источники, но соответствующие фрагменты не были возвращены, поэтому открыть ссылки нельзя. Проверяйте утверждения непосредственно по документам.",
    evidenceConsidered: "Рассмотрено фрагментов: {count}",
    model: "Модель",
    regenerate: "Сгенерировать заново",
    generate: "Сгенерировать",
    minQueryLength: "Задайте вопрос длиной не менее трёх символов.",

    summaryTitle: "Резюме с опорой на источники",
    summaryDescription:
      "Что сказано в собственных документах кандидата. Это не оценка человека, здесь нет ни баллов, ни рекомендаций.",
    summaryGenerate: "Сгенерировать резюме",
    summaryRegenerate: "Сгенерировать заново",
    summaryEmpty: "Резюме пока не сгенерировано",
    summaryEmptyHint:
      "Сгенерируйте резюме, чтобы прочитать, что сказано в проиндексированных документах, с источником за каждым утверждением.",

    questionsTitle: "Вопросы к интервью",
    questionsDescription:
      "Подсказки для интервьюера, составленные по тому, что документы показывают и о чём умалчивают. Это не оценка и не балл.",
    questionsGenerate: "Сгенерировать вопросы",
    questionsRegenerate: "Сгенерировать заново",
    questionsEmpty: "Вопросы пока не сгенерированы",
    questionsEmptyHint:
      "Сгенерируйте вопросы, чтобы получить подсказки по подтверждениям кандидата в сопоставлении с требованиями вакансии.",
    questionReason: "Зачем спрашивать",
    questionsNoVacancy: "Сначала привяжите кандидата к вакансии",
    questionsNoVacancyHint:
      "Вопросы составляются по требованиям вакансии, поэтому кандидату нужен отклик.",
    questionsNone: "Генератор не вернул вопросов",
    questionsNoneHint:
      "Ни документы, ни требования не дали вопроса, который стоило бы задать. Это результат, а не ошибка.",

    mapTitle: "Сопоставление требований с подтверждениями",
    mapDescription:
      "Каждое требование вакансии и то, что подтверждает его в документах.",
    mapRun: "Запустить сопоставление",
    mapRerun: "Запустить снова",
    mapRunning: "Сверяем требования с документами…",
    mapNotRun: "Сопоставление ещё не запускалось",
    mapNotRunHint:
      "Запустите сопоставление, чтобы сверить каждое требование вакансии с проиндексированными документами кандидата.",
    mapLastRun: "Сопоставлено {date}",
    mapNeverRun: "Не запускалось",
    mapFoundCount: "Подтверждения есть у {found} из {total} требований",
    mapCheckedAgainst: "Сверено с «{vacancy}»",
    mapNoRequirements: "У этой вакансии пока нет требований",
    mapNoRequirementsHint:
      "Добавьте требования в вакансию — каждое будет сверено с документами кандидата.",
    mapMatchedTerms: "Совпало",
    mapMissingTerms: "Не найдено",
    mapReason: "Почему",
    mapForbidden:
      "Ваша роль позволяет читать сопоставление, но не запускать его. Попросите рекрутера или администратора.",
    noOverallScore:
      "Общей оценки соответствия нет. Каждое требование показано отдельно, а вывод остаётся за вами.",

    statusGroundedHint: "Составлено по приведённым ниже фрагментам.",
    statusInsufficientHint:
      "В проиндексированных документах недостаточно данных для ответа. Пробел ничем не заполнялся.",
    statusNeedsReviewHint:
      "Найдено что-то похожее, но оценить это должен человек.",

    generationUnavailable: "AI-генерация временно недоступна",
    generationUnavailableHint:
      "AI-генерация временно недоступна. Поиск по подтверждениям продолжает работать.",
    retrievalUnavailable: "Поиск по подтверждениям временно недоступен",
    retrievalUnavailableHint:
      "Сервис, читающий проиндексированные документы, сейчас недоступен, поэтому искать и цитировать нечего. Повторите позже.",
    networkFailed: "Не удалось связаться с сервером",
    networkFailedHint:
      "Запрос не прошёл. Проверьте соединение и повторите попытку.",
    noEvidence: "Подтверждений не найдено",
    noEvidenceHint:
      "В проиндексированных документах нет подтверждений. Это вывод о документах, а не суждение о кандидате.",
    notProcessed: "Ни один документ ещё не обработан",
    notProcessedHint:
      "AI-функции читают проиндексированные документы. Загрузите резюме и дождитесь окончания обработки.",
    stillProcessing: "Документы ещё обрабатываются",
    stillProcessingHint:
      "AI-функции станут доступны, когда все документы будут проиндексированы.",
    processingFailed: "Обработка документов не удалась",
    processingFailedHint:
      "Документы этого кандидата не удалось обработать, поэтому читать нечего. Причину смотрите в очереди обработки.",
    notLinked: "Кандидат не привязан к вакансии",
    notLinkedHint:
      "И сопоставление требований, и вопросы к интервью требуют вакансии для сравнения.",
    citationSourceLanguageNote:
      "Цитируемые фрагменты остаются на языке оригинального документа.",
  },

  evidence: {
    title: "Подтверждения",
    requirementsSummary: "Подтверждения есть у {found} из {total} требований",
    checkedAgainst: "Сверено с «{vacancy}»",
    noVacancy: "Вакансия не привязана",
    noVacancyHint:
      "Привяжите кандидата к вакансии, чтобы сверить его документы с её требованиями.",
    noDocuments: "Нет документов для чтения",
    noDocumentsHint:
      "Подтверждения берутся из загруженных файлов. Начните с загрузки резюме.",
    analysisRunning: "Анализ ещё идёт",
    analysisRunningHint:
      "Подтверждения появятся, когда все документы будут проиндексированы.",
    processingFailed: "Обработка документов не удалась",
    processingFailedHint:
      "Документы этого кандидата не удалось обработать, поэтому показывать нечего. Причину смотрите в очереди обработки.",
    nothingSupports:
      "В загруженных документах нет ничего, что подтверждало бы это требование. Это не суждение о кандидате — спросите на интервью.",
    openAtPage: "Открыть {name} на странице {page}",
    openDocument: "Открыть {name}",
    openSource: "Открыть {name}",
  },

  processing: {
    title: "Обработка",
    description:
      "Все загруженные документы и их место в конвейере разбор → индексация.",
    pipeline: "Конвейер",
    ingested: {
      one: "принят {count} документ",
      few: "принято {count} документа",
      many: "принято {count} документов",
      other: "принято {count} документа",
    },
    searchPlaceholder: "Поиск по файлу или кандидату",
    searchLabel: "Поиск по очереди обработки",
    filterState: "Фильтр по состоянию",
    allStates: "Все состояния",
    shownOfTotal: "{shown} из {total}",
    workInProgress: " · идёт работа",
    columnDocument: "Документ",
    columnProgress: "Прогресс",
    columnAttempts: "Попытки",
    columnUpdated: "Обновлено",
    columnState: "Состояние",
    caption: "Очередь обработки",
    notLinked: "Не связан с кандидатом",
    queueEmpty: "Очередь пуста",
    queueEmptyHint:
      "Загрузите резюме — оно пройдёт разбор, разбиение, векторизацию и индексацию.",
    noMatches: "Ничего не найдено",
    noMatchesHint: "Снимите фильтр, чтобы увидеть больше задач.",
    retryNote:
      "Неудачная задача сохраняет свою ошибку, чтобы причина была видна. Кнопки повтора нет, потому что API её не предоставляет — загрузите файл заново.",
    queueEmptyShort: "В очереди обработки ничего нет.",
    failed: "Ошибка",
    progressLabel: "Прогресс: {name}",
    stageLabel: "{stage}: {reached} из {total}",
  },

  compare: {
    title: "Сравнение кандидатов",
    description:
      "Поставьте подтверждения по требованиям рядом — с исходным фрагментом за каждой ячейкой.",
    selectTitle: "Выбор кандидатов",
    selectDescription: "Выберите от {min} до {max} кандидатов одной вакансии.",
    selectedCount: "{count} / {max}",
    vacancy: "Вакансия",
    vacancyOption: "{title} ({count})",
    nothingToCompare: "Сравнивать пока нечего",
    nothingToCompareHint:
      "Как только у вакансии появятся кандидаты с проиндексированными резюме, их подтверждения можно будет поставить рядом.",
    noneProcessed: "Ни один кандидат этой вакансии ещё не обработан.",
    processedRatio:
      "Обработано {ready} из {total} кандидатов этой вакансии. Остальные появятся, когда их документы будут проиндексированы.",
    selectAtLeast: "Выберите минимум {min} кандидатов",
    selectAtLeastHint:
      "Сравнение выстраивает подтверждения по требованиям из документов каждого кандидата.",
    tableCaption: "Подтверждения по требованиям вакансии «{vacancy}»",
    columnRequirement: "Требование",
    legendTitle: "Что означают ячейки",
    legendFound: "Фрагмент документа подтверждает это требование.",
    legendNotFound:
      "В документах об этом не сказано. Отсутствие подтверждения — не доказательство отсутствия.",
    legendReview: "Найдено что-то похожее, но оценить это должен человек.",
    legendNotRun:
      "Для этого кандидата и этой вакансии сопоставление ещё не запускалось.",
    noWinner:
      "Эта таблица сравнивает содержимое документов. Она не ранжирует кандидатов и не рекомендует найм — решение остаётся за вами.",
    couldNotBuild: "Не удалось построить сравнение.",
    runMapping: "Запустить сопоставление для выбранных",
    mappingRunning: "Выполняется сопоставление…",
    unmappedNote:
      "Для {count} из выбранных кандидатов нет сохранённого сопоставления по этой вакансии. Запустите его, чтобы заполнить эти столбцы.",
  },

  /**
   * The caller's own account — shared by the recruiter settings screen and
   * the job seeker's profile, because both edit the same three fields.
   */
  account: {
    title: "Ваш аккаунт",
    description: "Имя, адрес для входа и фотография профиля.",
    fullName: "Полное имя",
    email: "Эл. почта",
    emailHint: "Этот адрес используется для входа.",
    uploadPhoto: "Загрузить фото",
    changePhoto: "Изменить фото",
    removePhoto: "Удалить фото",
    photoHint: "PNG, JPEG или WebP, до 5 МБ. Необязательно — без фото отображаются ваши инициалы.",
    saveChanges: "Сохранить изменения",
    saveFailed: "Не удалось сохранить профиль.",
    photoFailed: "Не удалось изменить фотографию.",
    imageTypeError: "Этот файл не является поддерживаемым изображением. Используйте PNG, JPEG или WebP.",
    imageTooLarge: "Изображение слишком большое. Максимум — 5 МБ.",
  },

  settings: {
    title: "Настройки",
    description: "Ваш профиль, организация и доступ участников.",
    tabProfile: "Профиль",
    tabOrganization: "Организация",
    tabTeam: "Команда",
    tabIntegrations: "Интеграции",
    tabSecurity: "Безопасность",
    tabLanguage: "Язык",
    yourProfile: "Ваш профиль",
    yourProfileHint: "Каким вас видят остальные в этом пространстве.",
    fullName: "Имя и фамилия",
    email: "Эл. почта",
    organization: "Организация",
    organizationHint: "Применяется ко всем в этом пространстве.",
    organizationName: "Название организации",
    workspaceUrl: "Адрес пространства",
    slugLocked: "Смена адреса сломает существующие ссылки.",
    countMembers: "Участники",
    countVacancies: "Вакансии",
    countCandidates: "Кандидаты",
    countDocuments: "Документы",
    team: "Команда",
    teamAccess: {
      one: "{count} человек имеет доступ к этому пространству.",
      few: "{count} человека имеют доступ к этому пространству.",
      many: "{count} человек имеют доступ к этому пространству.",
      other: "{count} человека имеют доступ к этому пространству.",
    },
    inviteNote:
      "API создаёт коллег с паролем, который задаёт администратор, а не по приглашению на почту, поэтому процесса приглашения здесь пока нет.",
    integrations: "Интеграции",
    integrationsHint:
      "Забирайте отклики из почты и с job-бордов, чтобы все источники попадали в одну воронку.",
    integrationsUnavailable:
      "Пока ничего нельзя подключить — у API нет ни эндпоинтов интеграций, ни хранилища учётных данных. Список показывает задуманную форму; ничто здесь не сообщит о подключении, которого нет.",
    connect: "Подключить",
    security: "Безопасность",
    sessionHandling: "Работа с сессией",
    sessionHandlingHint:
      "Сессия хранится в cookie, недоступной скриптам страницы. Выход очищает её, но сам токен остаётся действительным до истечения срока, потому что у API нет эндпоинта отзыва.",
    role: "Роль",
    workspaceCreated: "Пространство создано",
    changePassword: "Сменить пароль",
    enableTwoFactor: "Включить двухфакторную аутентификацию",
    disabledNote:
      "Отключено, потому что API этого пока не предоставляет. До тех пор кнопки ничего не сделают.",
    couldNotSave: "Не удалось сохранить.",
    languageTitle: "Язык",
    languageHint:
      "Задаёт язык интерфейса и язык, на котором пишутся AI-ответы. Цитаты из резюме остаются на языке оригинала.",
    languageStoredLocally:
      "Выбор хранится в этом браузере. В аккаунте есть сохранённый язык — он подставляется на устройстве, которое ещё не видело эту настройку, — но у API нет поля для его изменения, поэтому смена языка здесь не переносится на другие устройства.",
    organizationUrl: "URL организации",
    organizationUrlPlaceholder: "https://northwind.example",
    organizationUrlHint: "Необязательно. Отображается в рабочем пространстве; оставьте пустым, чтобы удалить.",
  },

  personal: {
    findJobs: "Найти работу",
    findJobsDescription:
      "Смотрите открытые вакансии и откликайтесь резюме из своего профиля.",
    findJobsUnavailable: "Поиск вакансий ещё не открыт",
    findJobsUnavailableHint:
      "Сейчас вакансии живут внутри каждой нанимающей организации и доступны только её команде. Публичного списка нет, а выдуманный показывал бы роли, на которые нельзя откликнуться.",
    findJobsRequires: [
      "Публичный эндпоинт вакансий, отдающий только роли в статусе OPEN с отображаемым названием организации — без внутренних черновиков и архива",
      "Устойчивый публичный идентификатор вакансии, чтобы ссылкой можно было делиться вне пространства",
    ],
    jobDetail: "Вакансия",
    job: "Вакансия",
    jobUnavailable: "Эту вакансию пока нельзя показать публично",
    jobUnavailableHint:
      "Чтение вакансии требует членства в разместившей её организации, поэтому соискателю нечего открыть. Отклик зависит от того же контракта.",
    jobRequires: [
      "Публичный эндпоинт вакансии, отдающий только название, описание, требования, локацию и тип занятости",
      "Эндпоинт, позволяющий авторизованному соискателю откликнуться самому",
    ],
    myApplications: "Мои отклики",
    myApplicationsDescription: "Все роли, на которые вы откликнулись, и их статус.",
    myApplicationsUnavailable:
      "Отклики учитываются по организации, а не по человеку",
    myApplicationsUnavailableHint:
      "Сейчас отклик указывает на запись кандидата, принадлежащую рекрутеру внутри одной организации. Ничто не связывает такие записи с самим человеком, поэтому посмотреть «мои» отклики невозможно.",
    myApplicationsRequires: [
      "CandidateAccount, принадлежащий вошедшему пользователю",
      "Связь Application с этой учётной записью, чтобы соискатель видел свои отклики, не состоя в организации",
    ],
    stagesTitle: "Как читаются этапы",
    stagesHint:
      "Каждый переход выполняет рекрутер — ничто здесь не двигается само.",
    myProfile: "Мой профиль",
    myProfileDescription: "Что видят рекрутеры, когда вы откликаетесь.",
    myProfileUnavailable: "Профиля соискателя пока нет",
    myProfileUnavailableHint:
      "Вы вошли как {email}, но эта учётная запись существует только как участник нанимающей организации. Профилю соискателя — заголовку, навыкам, опыту, образованию, языкам и основному резюме — негде храниться.",
    myProfileRequires: [
      "Модель CandidateAccount, принадлежащая пользователю, отдельно от записи Candidate, принадлежащей рекрутеру",
      "Эндпоинты для чтения и изменения этого профиля его владельцем",
      "Настройка видимости профиля, чтобы соискатель решал, кто его видит",
    ],
    savedJobs: "Сохранённые вакансии",
    savedJobsDescription: "Роли, к которым вы хотите вернуться.",
    savedJobsUnavailable: "Сохранение вакансий пока недоступно",
    savedJobsUnavailableHint:
      "Сохранённые роли должны принадлежать вашей учётной записи, чтобы переходить с устройства на устройство — и позже в мобильное приложение. Хранение в этом браузере выглядело бы рабочим, пока вы не войдёте где-то ещё.",
    savedJobsRequires: [
      "Коллекция сохранённых вакансий на CandidateAccount",
      "Эндпоинты для сохранения, чтения и удаления сохранённой вакансии",
    ],
  },

  errors: {
    somethingWentWrong: "Что-то пошло не так",
    pageLoadFailed: "Страницу не удалось загрузить. Обычно помогает повтор.",
    notFoundTitle: "Страница не найдена",
    notFoundHint: "Такой страницы нет в {app} или она была перемещена.",
    goToDashboard: "Перейти к обзору",
    waitingOn: "Ожидается",
    validation: "Проверьте отмеченные поля и повторите попытку.",
    unauthorized: "Сессия истекла. Войдите снова, чтобы продолжить.",
    forbidden: "Ваша роль не позволяет это действие.",
    notFound: "Мы не нашли то, что вы искали.",
    conflict: "Это конфликтует с уже существующей записью.",
    rateLimited: "Слишком много попыток. Подождите немного и повторите.",
    server: "На нашей стороне произошла ошибка. Повторите позже.",
    network: "Не удалось связаться с сервером. Проверьте соединение и повторите.",
    unavailable: "Сервис временно недоступен. Повторите позже.",
  },

  integrations: {
    groupEmail: "Почта",
    groupEmailHint:
      "Забирайте отклики, приходящие письмами с вложениями, в тот же конвейер обработки, что и загруженные резюме.",
    groupJobBoards: "Job-борды",
    groupJobBoardsHint:
      "Принимайте кандидатов с job-бордов, чтобы все источники попадали в одну воронку.",
    gmail: "Читать отклики из общего почтового ящика найма.",
    outlook: "Читать отклики из ящика найма в Microsoft 365.",
    saramin: "Корейский job-борд.",
    wanted: "Корейская платформа найма в IT.",
    jobkorea: "Корейский job-борд.",
    jumpit: "Корейская платформа найма разработчиков.",
    linkedin:
      "Доступно только через партнёрскую программу LinkedIn — продукт не будет скрапить или имитировать закрытые эндпоинты.",
    indeed:
      "Доступно только через партнёрскую программу Indeed, на тех же условиях.",
  },

  tables: {
    vacancy: "Вакансия",
    candidate: "Кандидат",
    department: "Отдел",
    location: "Локация",
    type: "Тип",
    status: "Статус",
    candidates: "Кандидаты",
    created: "Создана",
    experience: "Опыт",
    documents: "Документы",
    processing: "Обработка",
    updated: "Обновлено",
    empty: "—",
    locationNotSet: "Локация не указана",
    noVacancyAssigned: "Вакансия не назначена",
    more: "ещё {count}",
    yearsExperience: {
      one: "{count} год опыта",
      few: "{count} года опыта",
      many: "{count} лет опыта",
      other: "{count} года опыта",
    },
    searchVacancies: "Поиск по названию, отделу или локации",
    searchVacanciesLabel: "Поиск вакансий",
    searchCandidates: "Поиск по имени, должности, локации или навыку",
    searchCandidatesLabel: "Поиск кандидатов",
    filterByStatus: "Фильтр по статусу",
    filterByDepartment: "Фильтр по отделу",
    filterByVacancy: "Фильтр по вакансии",
    filterByProcessing: "Фильтр по состоянию обработки",
    sortCandidates: "Сортировка кандидатов",
    allProcessingStates: "Все состояния обработки",
    noDocumentsFilter: "Без документов",
    noneUploaded: "Не загружено",
    captionVacancies: "Вакансии",
    captionCandidates: "Кандидаты",
    sortNameAZ: "По имени (А–Я)",
    sortExperienceYears: "По годам опыта",
    vacanciesEmptyHint:
      "Создайте вакансию, чтобы задать требования, которые копилот будет искать в каждом резюме.",
    vacanciesNoMatchHint: "Измените поиск или фильтры, чтобы расширить выдачу.",
    candidatesEmptyHint:
      "Загрузите резюме из вакансии или очереди обработки, чтобы наполнить воронку.",
    candidatesNoMatchHint: "Попробуйте более широкий запрос или снимите один из фильтров.",
    yearsShort: {
      one: "{count} г.",
      few: "{count} г.",
      many: "{count} лет",
      other: "{count} г.",
    },
  },

  vacancyForm: {
    roleTitle: "Роль",
    roleHint: "Как вакансия будет выглядеть в списке.",
    title: "Название",
    titlePlaceholder: "Senior Backend Engineer",
    department: "Отдел",
    departmentPlaceholder: "Инженерия",
    location: "Локация",
    locationPlaceholder: "Ташкент, Узбекистан · гибрид",
    employmentType: "Тип занятости",
    experienceLevel: "Уровень",
    descriptionTitle: "Описание вакансии",
    descriptionHint: "Можно вставить текст объявления как есть.",
    description: "Описание",
    descriptionPlaceholder:
      "За что отвечает команда, что будет делать человек, с кем работает…",
    requirementsTitle: "Требования",
    requirementsHint:
      "Каждая строка становится проверкой подтверждений по каждому загруженному резюме.",
    addRequirement: "Добавить требование",
    requirementAria: "Требование {index}",
    priorityAria: "Приоритет требования {index}",
    typeAria: "Тип требования {index}",
    removeAria: "Удалить требование {index}",
    requirementsNote:
      "Формулируйте коротко и проверяемо — «Kubernetes» или «3+ года бэкенда» читаются в таблице подтверждений лучше, чем целый абзац.",
    saveDraft: "Сохранить черновик",
    publish: "Опубликовать вакансию",
    errTitle: "Укажите название вакансии.",
    errDepartment: "Укажите отдел.",
    errLocation: "Укажите локацию.",
    errDescription: "Опишите роль, чтобы у требований был контекст.",
    errRequirements:
      "Добавьте хотя бы одно требование — именно с ним сверяется каждое резюме.",
    examples: ["NestJS", "Redis", "Kubernetes", "3+ года опыта в бэкенде"],
  },

  candidateForm: {
    candidateTitle: "Кандидат",
    candidateHint: "Обязательно только имя — остальное можно взять из резюме.",
    vacancyTitle: "Вакансия",
    vacancyHint:
      "Привязка к вакансии даёт проверкам требований то, с чем сравнивать.",
    applyToVacancy: "Откликнуться на вакансию",
    noVacancy: "Пока без вакансии",
    errVacancyRequired: "Выберите свою вакансию, в которую добавить кандидата.",
  },

  vacancyDetail: {
    breadcrumbNew: "Новая",
    jobDescription: "Описание вакансии",
    noDescription: "Для этой вакансии описание не добавлено.",
    requirements: "Требования",
    requirementsSplit: "обязательных: {must} · желательных: {nice}",
    noRequirements: "Требований пока нет",
    noRequirementsHint:
      "С требованиями сверяется каждое загруженное резюме. Без них искать подтверждения не для чего.",
    candidatesAttached: {
      one: "{count} кандидат привязан к этой вакансии",
      few: "{count} кандидата привязаны к этой вакансии",
      many: "{count} кандидатов привязаны к этой вакансии",
      other: "{count} кандидата привязаны к этой вакансии",
    },
    noCandidates: "Откликов пока нет",
    noCandidatesHint:
      "Кандидаты, откликнувшиеся на эту вакансию, появятся здесь, и каждое резюме сверяется с требованиями выше.",
    atAGlance: "Кратко",
    lastUpdated: "Обновлено",
    readingResumes: "Как читаются резюме",
    readingResumesHint:
      "Кандидаты сами прикладывают резюме, когда откликаются. Каждое присланное резюме читается и сверяется с требованиями выше — за них ничего не загружается.",
    created: "Создана {date}",
    deletedOrWrongLink: "Вакансия могла быть удалена, либо ссылка неверна.",
    candidateRemovedOrWrongLink:
      "Кандидат мог быть удалён, либо ссылка неверна.",
    newVacancyTitle: "Создание вакансии",
    newVacancyHint:
      "Требования, добавленные здесь, — это то, с чем сверяется каждое загруженное резюме.",
    scopedSearchLabel: "Поиск по кандидатам этой вакансии",
    scopedSearchPlaceholder:
      "Спросите обычным языком — например: кто эксплуатировал Kubernetes в проде?",
    scopedSearchNote:
      "В результатах виден фрагмент, из которого взято совпадение, с документом и страницей. Модель никого не оценивает и не ранжирует.",
  },

  uploader: {
    dragOrBrowse: "Перетащите резюме сюда или выберите файлы",
    sizeHint: "PDF или DOCX, до {size} каждый. Можно несколько файлов.",
    selectFiles: "Выбрать файлы",
    uploading: "Загрузка",
    skipped: {
      one: "{count} файл пропущен",
      few: "{count} файла пропущено",
      many: "{count} файлов пропущено",
      other: "{count} файла пропущено",
    },
    pipeline: "Конвейер",
    indexedOf: "проиндексировано {done} из {total}",
    failedSuffix: " · с ошибкой: {count}",
    removeFromList: "Убрать {name} из списка",
    clearList: "Очистить список",
    hideUploader: "Скрыть загрузку",
    uploadResumes: "Загрузить резюме",
    progressLabel: "Прогресс: {name}",
  },

  employmentType: {
    "Full-time": "Полная занятость",
    "Part-time": "Частичная занятость",
    Contract: "Контракт",
    Internship: "Стажировка",
    Temporary: "Временная работа",
  },

  experienceLevel: {
    Intern: "Стажёр",
    Junior: "Junior",
    "Mid-level": "Middle",
    Senior: "Senior",
    Lead: "Lead",
    Principal: "Principal",
  },

  workspaces: {
    title: "Выберите пространство",
    description:
      "Вход один. У каждого пространства свои данные и своя роль.",
    organizations: "Организации",
    noOrganizations: "Вы пока не состоите ни в одной организации.",
    noOrganizationsHint:
      "Владелец или HR-администратор может добавить вас в свою. До этого нет пространства организации, которое можно открыть.",
    current: "Текущее",
    open: "Открыть",
    switching: "Переключаем пространство…",
    switchFailed: "Не удалось переключить пространство.",
    switchedTo: "Вы в «{name}»",
    membershipRevoked: "Доступ к этому пространству отозван",
    membershipRevokedHint:
      "Выберите другое пространство, чтобы продолжить. Если это ошибка, обратитесь к администратору организации.",
  },

  /**
   * Профессиональные ссылки — половина функции на стороне соискателя.
   *
   * Тексты ошибок написаны для человека, а не для оператора: что произошло с
   * ЕГО ссылкой и что можно сделать. HTTP-статусы, имена хостов и внутренние
   * причины не показываются никогда.
   */
  candidateLinks: {
    title: "Профессиональные ссылки",
    hint: "До {limit} публичных ссылок — портфолио, репозиторий, страница проекта. Анализируются так же, как ваши файлы.",
    empty: "Ссылок пока нет.",
    add: "Добавить ссылку",
    remove: "Удалить",
    retry: "Попробовать снова",
    refresh: "Обновить анализ",
    urlLabel: "Ссылка",
    urlPlaceholder: "https://your-portfolio.com",
    labelLabel: "Название (необязательно)",
    labelPlaceholder: "Моё портфолио",
    slots: "использовано {count} из {limit} ссылок",
    analysedOn: "Проанализировано {date}",
    limitReached:
      "Все слоты для ссылок заняты. Удалите одну, чтобы добавить другую. Файлы считаются отдельно.",
    privacyNote:
      "Сохранённые ссылки видны только в вашем профиле. При отклике вместе с ним отправляется копия прочитанного. Редактирование ссылки не переписывает уже отправленный отклик, но удаление убирает её и оттуда.",
    addFailed: "Не удалось добавить эту ссылку.",
    removeFailed: "Не удалось удалить эту ссылку.",
    retryFailed: "Не удалось проанализировать эту ссылку повторно.",
    confirmDeleteTitle: "Удалить эту профессиональную ссылку?",
    confirmDeleteQuestion: "«{name}» будет удалена из вашего профиля.",
    confirmDeleteConsequence:
      "Эти материалы также исчезнут из уже отправленных откликов и из ИИ-анализа, который видят рекрутеры. Сами отклики останутся.",
    errorCodes: {
      LINK_LIMIT_REACHED:
        "Можно сохранить до 3 профессиональных ссылок. Удалите одну, чтобы добавить другую.",
      LINK_DUPLICATE: "Эта ссылка уже добавлена.",
      LINK_INVALID_URL:
        "Это не похоже на публичный веб-адрес. Проверьте его и попробуйте снова.",
      LINK_NOT_RETRYABLE:
        "Эту ссылку нельзя проанализировать повторно. Измените адрес или удалите её.",
      LINK_BUSY: "Эта ссылка уже анализируется.",
    },
    failureCodes: {
      INVALID_URL: "Не удалось прочитать этот адрес. Проверьте его и попробуйте снова.",
      UNSUPPORTED_PROTOCOL:
        "Можно использовать только публичные веб-адреса, начинающиеся с http:// или https://.",
      PRIVATE_NETWORK_URL:
        "Этот адрес недоступен из публичного интернета, поэтому его нельзя использовать здесь.",
      FETCH_TIMEOUT: "Сайт отвечал слишком долго. Можно попробовать снова.",
      TOO_MANY_REDIRECTS:
        "Этот адрес всё время перенаправлял. Попробуйте прямую ссылку на страницу.",
      CONTENT_TOO_LARGE:
        "Эта страница слишком большая для анализа. Попробуйте сослаться на конкретную страницу.",
      UNSUPPORTED_CONTENT_TYPE:
        "Ссылка ведёт на тип файла, который мы не читаем. Загрузите файлы в разделе файлов.",
      ACCESS_DENIED:
        "Эта страница недоступна публично — возможно, нужен вход или её больше нет.",
      NO_MEANINGFUL_CONTENT:
        "На этой странице не нашлось читаемого текста. Если содержимое отображается через JavaScript, сошлитесь на страницу с текстом.",
      RENDER_FAILED: "Не удалось открыть эту страницу. Можно попробовать снова.",
      UPSTREAM_ERROR: "Сайт вернул ошибку. Можно попробовать снова.",
      INDEXING_FAILED:
        "Страница прочитана, но её не удалось подготовить к анализу. Можно попробовать снова.",
    },
  },

  candidateProfile: {
    title: "Мой профиль",
    description: "Что видит команда найма, когда вы откликаетесь.",
    createTitle: "Создайте профиль соискателя",
    createHint:
      "Профиль не связан с организациями, где вы работаете. Он ваш, и содержимое определяете вы.",
    create: "Создать профиль",
    notCreated: "Вы ещё не создали профиль соискателя",
    basics: "Основное",
    basicsHint: "Шапка вашего профиля.",
    headline: "Заголовок",
    headlinePlaceholder: "Backend-инженер",
    location: "Локация",
    phone: "Телефон",
    summary: "О себе",
    summaryPlaceholder: "Несколько предложений о том, чем вы занимаетесь.",
    skills: "Навыки",
    skillsHint: "Нажмите Enter, чтобы добавить каждый.",
    languages: "Языки",
    experience: "Опыт",
    experienceHint: "Сначала последнее место. Даты — свободный текст: «2021», «2021-03».",
    addExperience: "Добавить место работы",
    removeExperience: "Удалить место работы {index}",
    jobTitle: "Должность",
    company: "Компания",
    startDate: "С",
    endDate: "По",
    roleDescription: "Чем занимались",
    education: "Образование",
    addEducation: "Добавить образование",
    removeEducation: "Удалить образование {index}",
    institution: "Учебное заведение",
    degree: "Степень",
    field: "Специальность",
    startYear: "Год начала",
    endYear: "Год окончания",
    visibility: "Видимость профиля",
    visibilityHint:
      "«Приватный» значит, что отправленное видят только те организации, куда вы откликнулись.",
    visibilityPrivate: "Приватный",
    visibilityPublic: "Публичный",
    resume: "Резюме",
    documents: "Документы резюме",
    resumeHint:
      "PDF или DOCX, до {size}. Самая новая загрузка станет резюме для будущих откликов.",
    noResume: "Резюме ещё не загружено",
    uploadResume: "Загрузить резюме",
    addDocument: "Добавить документ",
    replaceResume: "Заменить резюме",
    uploading: "Загрузка",
    downloadResume: "Открыть резюме",
    deleteDocument: "Удалить",
    primaryResume: "Основное",
    documentSlots: "Использовано {count} из {limit} документов",
    documentLimitReached:
      "Достигнут лимит в 3 документа. Удалите один документ, чтобы загрузить другой.",
    uploadedOn: "Загружено {date}",
    personalResumeNote:
      "Резюме остаётся только у вас. При отклике копия уходит в конкретную организацию — и только в неё.",
    errTitleRequired: "У места работы должна быть должность.",
    errInstitutionRequired: "У записи об образовании должно быть учебное заведение.",
    saveFailed: "Не удалось сохранить профиль.",
    createFailed: "Не удалось создать профиль.",
    resumeUploadFailed: "Не удалось загрузить файл.",
    documentDeleteFailed: "Не удалось удалить документ.",
    confirmDeleteTitle: "Удалить этот документ?",
    confirmDeleteQuestion: "«{name}» будет удалён безвозвратно.",
    confirmDeleteConsequence:
      "Эти материалы также исчезнут из уже отправленных откликов и из ИИ-анализа, который видят рекрутеры. Сами отклики останутся.",
  },

  jobs: {
    title: "Найти работу",
    description: "Открытые вакансии, куда можно откликнуться резюме из профиля.",
    searchPlaceholder: "Поиск по названию и описанию",
    searchLabel: "Поиск вакансий",
    locationPlaceholder: "Локация",
    locationLabel: "Фильтр по локации",
    submit: "Искать",
    clear: "Сбросить фильтры",
    resultCount: {
      one: "{count} открытая вакансия",
      few: "{count} открытые вакансии",
      many: "{count} открытых вакансий",
      other: "{count} открытой вакансии",
    },
    empty: "Сейчас открытых вакансий нет",
    emptyHint: "Новые вакансии появятся здесь, как только организации их опубликуют.",
    noMatches: "По этому запросу ничего не найдено",
    noMatchesHint: "Попробуйте меньше слов или снимите фильтр по локации.",
    postedOn: "Опубликовано {date}",
    save: "Сохранить",
    saved: "Сохранено",
    unsave: "Убрать из сохранённых",
    aboutRole: "О вакансии",
    noDescription: "У этой вакансии нет описания.",
    requirements: "Что они ищут",
    mustHave: "Обязательно",
    niceToHave: "Желательно",
    apply: "Откликнуться",
    applyAgain: "Откликнуться снова",
    previousAttemptRejected:
      "По вашему предыдущему отклику на эту вакансию был отказ. Вы можете откликнуться снова — прошлая попытка останется в истории.",
    applying: "Отправляем",
    applied: "Отклик отправлен",
    appliedHint: "Вы уже откликнулись. Следите за откликом в разделе «Мои отклики».",
    applySucceeded: "Отклик отправлен",
    applySucceededHint:
      "Копия резюме ушла в «{organization}». Там его прочитают и решат — ничего не оценивается автоматически.",
    viewApplications: "Мои отклики",
    notFound: "Эта вакансия больше не открыта",
    notFoundHint: "Возможно, её закрыли или уже закрыли позицию. Посмотрите другие.",
    backToJobs: "К списку вакансий",
    needsProfile: "Сначала создайте профиль",
    needsProfileHint:
      "При отклике отправляются профиль и резюме, поэтому нужны оба.",
    goToProfile: "Перейти в профиль",
    needsResume: "Сначала загрузите резюме",
    needsResumeHint: "К отклику прикладывается копия резюме, поэтому оно должно быть.",
    alreadyApplied: "Вы уже откликались",
    alreadyAppliedHint:
      "Один отклик на вакансию. Отзыв отклика не открывает её заново — команда найма всё ещё может продолжить с вашим.",
    jobUnavailable: "Эта вакансия больше не принимает отклики",
  },

  applications: {
    title: "Мои отклики",
    description: "Все вакансии, куда вы откликнулись, и их текущий этап.",
    empty: "Откликов пока нет",
    emptyHint: "Вакансии, куда вы откликнетесь, появятся здесь с текущим этапом.",
    appliedOn: "Отклик {date}",
    updatedOn: "Обновлено {date}",
    submittedResume: "Отправлено {name}",
    withdraw: "Отозвать",
    withdrawing: "Отзываем",
    withdrawn: "Отклик отозван",
    withdrawFailed: "Не удалось отозвать отклик.",
    cannotWithdraw: "Этот отклик уже нельзя отозвать",
    cannotWithdrawHint:
      "Его этап финальный. Менять его теперь может только команда найма.",
    stageNote:
      "Этапы выставляет команда найма. Единственное ваше действие — отозвать отклик.",
  },

  chat: {
    title: "Интервью-чаты",
    messages: "Сообщения",
    hrDescription:
      "Разговоры по вакансиям с кандидатами, приглашёнными на интервью.",
    candidateDescription:
      "Интервью-переписка по вакансиям, куда команда пригласила вас на интервью.",
    conversations: "Разговоры",
    conversationsHint: "Здесь показаны только интервью с доступным чатом.",
    noConversations: "Разговоров нет",
    noConversationsHint:
      "Чаты появятся после приглашения на интервью с платформенным разговором.",
    selectConversation: "Выберите разговор",
    selectConversationHint: "Выберите интервью-чат из списка.",
    loadingMessages: "Загрузка сообщений",
    emptyConversation: "Сообщений пока нет",
    emptyConversationHint: "Начните с короткого сообщения о деталях интервью.",
    inviteToInterview: "Пригласить на интервью",
    reject: "Отклонить",
    openChat: "Открыть чат",
    send: "Отправить",
    typeMessage: "Введите сообщение",
    you: "Вы",
    viewVacancy: "Открыть вакансию",
    viewJob: "Открыть вакансию",
    chatUnavailable: "Чат недоступен",
    candidateRejectedNotice:
      "Кандидат отклонён, и интервью-чат удалён.",
    vacancyClosedNotice: "Вакансия закрыта, и интервью-чат удалён.",
    chatDeleted: "Этот интервью-чат был удалён.",
    connected: "Подключено",
    connecting: "Подключение",
    reconnecting: "Переподключение",
    loadFailed: "Не удалось загрузить этот разговор.",
    sendFailed: "Не удалось отправить сообщение.",
    closeVacancy: "Закрыть вакансию",
    closeVacancyFailed: "Не удалось закрыть вакансию.",
    closeVacancyQuestion: "Вы уверены, что хотите закрыть эту вакансию?",
    areYouSure: "Вы уверены?",
    allChatsDeleted:
      "Все интервью-чаты по этой вакансии будут окончательно удалены.",
    yes: "Да",
    no: "Нет",
  },

  savedJobs: {
    title: "Сохранённые вакансии",
    description: "Вакансии, к которым вы хотели вернуться.",
    empty: "Пока ничего не сохранено",
    emptyHint: "Сохраните вакансию на доске — и она будет ждать здесь.",
    savedOn: "Сохранено {date}",
    remove: "Убрать",
    closed: "Уже закрыта",
    closedHint: "Эта вакансия закрылась после сохранения, откликнуться нельзя.",
    viewJob: "Открыть вакансию",
  },

  sessions: {
    title: "Устройства с активным входом",
    description:
      "Все браузеры и устройства с живой сессией. Выход применяется сразу.",
    thisDevice: "Это устройство",
    unknownDevice: "Неизвестное устройство",
    created: "Вход {date}",
    lastUsed: "Последняя активность {date}",
    expires: "Истекает {date}",
    signOut: "Выйти",
    signOutTitle: "Выйти на устройстве «{device}»",
    signingOut: "Выходим",
    signOutEverywhere: "Выйти везде",
    signOutEverywhereHint:
      "Завершает все сессии, включая текущую. Пригодится, если устройство потеряно.",
    revokeFailed: "Не удалось завершить эту сессию.",
    empty: "Других устройств с активным входом нет.",
    unavailable: "Не удалось загрузить сессии",
    unavailableHint: "Повторите позже — на текущую сессию это не влияет.",
  },

  authErrors: {
    AUTH_INVALID_REFRESH_TOKEN: "Сессия больше недействительна. Войдите снова.",
    AUTH_REFRESH_TOKEN_EXPIRED: "Сессия истекла. Войдите снова.",
    AUTH_REFRESH_TOKEN_REUSED:
      "Сессия завершена в целях безопасности: её учётные данные были использованы дважды. Войдите снова.",
    AUTH_SESSION_REVOKED: "Эта сессия была завершена. Войдите снова.",
    AUTH_SESSION_NOT_FOUND: "Такой сессии больше нет. Войдите снова.",
    generic: "Сессия завершена. Войдите снова.",
  },

  jobMatch: {
    title: "AI-подбор вакансий",
    description:
      "Открытые вакансии, подходящие вашему профилю и резюме, — с подтверждением по каждому совпадению.",
    introTitle: "Какие вакансии мне подходят?",
    introHint:
      "Подбор сравнивает ваш профиль и резюме с открытыми вакансиями и показывает, чем подтверждено каждое требование. Занимает около двадцати секунд.",
    run: "Подобрать вакансии",
    refresh: "Обновить подбор",
    clearResults: "Очистить результаты",
    matchCount: {
      one: "{count} подходящая вакансия",
      few: "{count} подходящие вакансии",
      many: "{count} подходящих вакансий",
      other: "{count} подходящих вакансий",
    } as Plural,
    loadingStages: [
      "Анализируем профиль и резюме…",
      "Ищем подходящие открытые вакансии…",
      "Сравниваем требования вакансий…",
      "Готовим обоснованные пояснения…",
    ],
    loadMore: "Показать ещё",
    loadingMore: "Загрузка…",
    showingCount: "показано {shown} из {total}",
    refreshing: "Обновляем…",
    refreshingHint:
      "Обновляем подбор в фоне. Текущие результаты остаются на экране.",
    refreshFailed:
      "Не удалось обновить подбор. Предыдущие результаты остаются на экране.",
    strength: {
      STRONG: "Сильное совпадение",
      PARTIAL: "Частичное совпадение",
      WEAK: "Слабое совпадение",
    },
    coverageNote:
      "Метки совпадения показывают, какая часть требований вакансии подтверждена вашими документами. Это не оценка вас и не рекомендация подавать заявку.",
    explanationPending:
      "Пояснение для этого совпадения ещё пишется. Данные ниже уже полные.",
    explanationUnavailable:
      "AI-пояснение временно недоступно. Подтверждения совпадения ниже остаются полными.",
    requirementSummary: "Сводка требований",
    supported: "Что совпадает",
    missing: "Чего не хватает",
    unclear: "Что неясно",
    noneInGroup: "В этой группе нет отмеченных пунктов.",
    required: "обязательно",
    viewEvidence: "Показать подтверждения",
    viewJob: "Открыть вакансию",
    needProfileTitle: "Сначала создайте профиль",
    needProfileHint:
      "Подбор работает по вашему профилю и резюме. Создайте профиль кандидата, чтобы начать.",
    notReadyTitle: "Добавьте материалы, чтобы пользоваться ИИ-подбором",
    notReadyHint:
      "Подбор читает ваши файлы и профессиональные ссылки. Загрузите резюме или добавьте ссылку — одного профиля недостаточно, это не подтверждение опыта.",
    completeProfile: "Заполнить профиль",
    goToProfile: "Перейти в профиль",
    staleNotice:
      "Ваши материалы изменились. Обновите подборку, чтобы проанализировать текущий профиль.",
    resumeImprovesWithLinks:
      "Добавьте резюме для более точного подбора. Ваши профессиональные ссылки уже анализируются.",
    resumeImproves:
      "Резюме повышает качество подбора: требования сверяются с вашими настоящими документами.",
    uploadResume: "Загрузить резюме",
    noMatches: "Сейчас подходящих вакансий нет",
    noMatchesHint:
      "Ни одна из открытых вакансий не совпала с вашим профилем. Новые вакансии проверяются по мере появления — загляните позже.",
    unavailable: "Подбор временно недоступен",
    unavailableHint:
      "Сервис подбора сейчас недоступен. Ничего не рассчитано — попробуйте позже.",
  },
  vacancyScope: {
    selectorLabel: "Моя вакансия",
    myVacancies: "Мои вакансии",
    choosePlaceholder: "Выберите вакансию",
    allVacancies: "Все мои вакансии",
    noneTitle: "Пока нет вакансий",
    noneHint: "Сначала создайте вакансию — кандидаты, подтверждения и переписки живут внутри неё.",
    invalidSelection: "Это не ваша вакансия",
    selectFirstTitle: "Выберите одну из своих вакансий",
    selectFirstHint: "Выберите вакансию выше, чтобы работать внутри неё.",
    notOwned: "Эту вакансию создал другой сотрудник вашей организации. Работать можно только внутри своих вакансий.",
    notFound: "Эта вакансия недоступна.",
    candidateNotInVacancy: "Этот кандидат не относится к выбранной вакансии.",
    noCandidatesTitle: "Откликов пока нет",
    noCandidatesHint: "Кандидаты, откликнувшиеся на эту вакансию, появятся здесь.",
    scopedToVacancy: "Для: {title}",
    select: "Выбрать",
    selected: "Выбрана",
    ownedByOther: "Создана коллегой",
    deleteSelected: "Удалить выбранные",
    deleteConfirmTitle: "Удалить выбранную вакансию?",
    deleteConfirmTitlePlural: "Удалить выбранные вакансии?",
    deleteConfirmHint: "Вместе с ними удалятся отклики кандидатов, подтверждения и переписки по собеседованиям.",
    yes: "Да",
    no: "Нет",
    deleting: "Удаление",
    deleteFailed: "Ничего не удалено. В выборе есть вакансия, которую вы не можете удалить.",
    deletedCount: {
      one: "Удалена {count} вакансия",
      few: "Удалено {count} вакансии",
      many: "Удалено {count} вакансий",
      other: "Удалено {count} вакансий",
    } as Plural,
    selectedCount: {
      one: "Выбрана {count}",
      few: "Выбрано {count}",
      many: "Выбрано {count}",
      other: "Выбрано {count}",
    } as Plural,
    selectAll: "Выбрать все",
    clearSelection: "Снять выбор",
    chatUnavailable: "Переписка недоступна",
    chatUnavailableHint: "Возможно, она удалена или относится к вакансии, которую создали не вы.",
    accountRequired: "У этого кандидата нет аккаунта на платформе, поэтому переписка недоступна.",
  },
  status: {
    vacancy: {
      DRAFT: "Черновик",
      OPEN: "Открыта",
      CLOSED: "Закрыта",
      ARCHIVED: "В архиве",
    },
    document: {
      UPLOADED: "Загружен",
      QUEUED: "В очереди",
      PARSING: "Разбор",
      CHUNKING: "Разбиение",
      EMBEDDING: "Векторизация",
      INDEXING: "Индексация",
      COMPLETED: "Готово",
      FAILED: "Ошибка",
    },
    /** Жизненный цикл ссылки. Описывает загрузку, а не человека. */
    link: {
      PENDING: "Ожидает",
      FETCHING: "Читаем страницу",
      PROCESSING: "Анализируем",
      COMPLETED: "Проанализировано",
      FAILED: "Не удалось прочитать",
    },
    pipeline: {
      UPLOADED: "Загружен",
      PARSING: "Разбор",
      CHUNKING: "Разбиение",
      EMBEDDING: "Векторизация",
      INDEXING: "Проиндексирован",
      COMPLETED: "Готово",
    },
    job: {
      PENDING: "Ожидает",
      QUEUED: "В очереди",
      RUNNING: "Выполняется",
      COMPLETED: "Готово",
      FAILED: "Ошибка",
    },
    documentType: {
      RESUME: "Резюме",
      PORTFOLIO: "Портфолио",
      JOB_DESCRIPTION: "Описание вакансии",
      HR_DOCUMENT: "HR-документ",
    },
    requirementType: {
      SKILL: "Навык",
      EXPERIENCE: "Опыт",
      EDUCATION: "Образование",
      LANGUAGE: "Язык",
      OTHER: "Другое",
    },
    application: {
      NEW: "Новый",
      REVIEWING: "На рассмотрении",
      INTERVIEW: "Интервью",
      OFFER: "Оффер",
      HIRED: "Принят",
      REJECTED: "Отказ",
      WITHDRAWN: "Отозван",
    },
    applicationSource: {
      DIRECT: "Напрямую",
      EMAIL: "Почта",
      LINKEDIN: "LinkedIn",
      INDEED: "Indeed",
      SARAMIN: "Saramin",
      JOBKOREA: "JobKorea",
      WANTED: "Wanted",
      JUMPIT: "Jumpit",
      REFERRAL: "Рекомендация",
      MANUAL_UPLOAD: "Ручная загрузка",
    },
    role: {
      OWNER: "Владелец",
      HR_ADMIN: "HR-администратор",
      RECRUITER: "Рекрутер",
      INTERVIEWER: "Интервьюер",
    },
    evidence: {
      FOUND: "Подтверждение найдено",
      NOT_FOUND: "Подтверждений не найдено",
      NEEDS_REVIEW: "Нужна проверка человеком",
      NOT_RUN: "Сопоставление не запускалось",
    },
    evidenceShort: {
      FOUND: "Найдено",
      NOT_FOUND: "Не найдено",
      NEEDS_REVIEW: "Проверить",
      NOT_RUN: "Не запускалось",
    },
    answer: {
      GROUNDED: "С опорой на источники",
      INSUFFICIENT_EVIDENCE: "Недостаточно подтверждений",
      NEEDS_HUMAN_REVIEW: "Нужна проверка человеком",
    },
    questionKind: {
      evidence_probe: "Уточнение по подтверждению",
      missing_requirement_probe: "Отсутствующее требование",
    },
    requirementPriority: {
      required: "Обязательно",
      optional: "Желательно",
    },
    stream: {
      connecting: "Подключение",
      live: "В эфире",
      reconnecting: "Переподключение",
      offline: "Не отслеживается",
    },
    candidateStage: {
      NEW: "Отправлен",
      REVIEWING: "На рассмотрении",
      INTERVIEW: "Интервью",
      OFFER: "Оффер",
      HIRED: "Принят",
      REJECTED: "Не выбран",
      WITHDRAWN: "Отозван",
    },
    candidateStageHint: {
      NEW: "Ваш отклик получен.",
      REVIEWING: "Кто-то из команды найма читает ваш отклик.",
      INTERVIEW: "Вы дошли до этапа интервью.",
      OFFER: "Оффер готовится или уже отправлен.",
      HIRED: "Вы приняли предложение.",
      REJECTED: "Команда решила не продолжать.",
      WITHDRAWN: "Вы отозвали этот отклик.",
    },
    integrationAvailability: {
      planned: "Не подключено",
      requires_partner_approval: "Нужно одобрение партнёра",
    },
  },
};

export default ru;
