/**
 * Uzbek (Latin) UI strings.
 *
 * Terminology follows Uzbek HR usage: vakansiya, nomzod, rezyume, intervyu
 * savollari, dalil topildi / dalil topilmadi / inson tekshiruvi zarur.
 * Uzbek has two plural categories (one / other) under CLDR.
 *
 * The modifier letter turned comma (ʻ) is used in oʻ and gʻ throughout, so the
 * spelling stays consistent with the locale label in `LOCALE_META`.
 */
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Plural } from "@/lib/i18n/dictionaries/en";

const uz: Dictionary = {
  meta: {
    appName: "HR Copilot AI",
    tagline: "Ishga qabul qilish tahlili",
    description:
      "Dalilga asoslangan ishga qabul tahlili: rezyumelarni oddiy tilda qidiring, har bir maʼlumotni manbagacha kuzating, qaror esa insonda qolsin.",
  },

  datetime: {
    months: [
      "yan", "fev", "mar", "apr", "may", "iyn",
      "iyl", "avg", "sen", "okt", "noy", "dek",
    ],
    date: "{day}-{month}, {year}",
    dateTime: "{day}-{month}, {time}",
    time: "{hour}:{minute}",
    justNow: "hozirgina",
    minutesAgo: {
      one: "{count} daqiqa oldin",
      other: "{count} daqiqa oldin",
    },
    hoursAgo: {
      one: "{count} soat oldin",
      other: "{count} soat oldin",
    },
    daysAgo: {
      one: "{count} kun oldin",
      other: "{count} kun oldin",
    },
    groupSeparator: "\u00A0",
    decimalSeparator: ",",
  },

  common: {
    save: "Oʻzgarishlarni saqlash",
    saved: "Saqlandi",
    cancel: "Bekor qilish",
    edit: "Tahrirlash",
    close: "Yopish",
    retry: "Qayta urinish",
    search: "Qidirish",
    filter: "Filtr",
    clear: "Tozalash",
    viewAll: "Hammasini koʻrish",
    back: "Orqaga",
    next: "Keyingi",
    previous: "Oldingi",
    open: "Ochish",
    loading: "Yuklanmoqda",
    notRecorded: "Kiritilmagan",
    notSet: "Lavozim kiritilmagan",
    none: "Yoʻq",
    page: "sahifa",
    showMore: "Toʻliq koʻrsatish",
    showLess: "Yigʻish",
    pagination: "Sahifalash",
    pageOf: "{page} / {total}",
    pageNumber: "{page}-sahifa",
    language: "Til",
    changeLanguage: "Tilni oʻzgartirish",
    humanDecision: "Qarorni inson qabul qiladi",
    of: "{total} tadan {count} ta",
    years: {
      one: "{count} yil",
      other: "{count} yil",
    },
    candidates: {
      one: "{count} nomzod",
      other: "{count} nomzod",
    },
    files: {
      one: "{count} fayl",
      other: "{count} fayl",
    },
    documents: {
      one: "{count} hujjat",
      other: "{count} hujjat",
    },
    passages: {
      one: "{count} mos parcha",
      other: "{count} mos parcha",
    },
  },

  nav: {
    sectionWorkspace: "Ish maydoni",
    sectionJobSearch: "Ish qidirish",
    sectionFindJobs: "Ish topish",
    sectionAiJobSearch: "AI ish qidiruvi",
    sectionYourSearch: "Mening ish qidiruvim",
    plans: "Tariflar",
    dashboard: "Boshqaruv paneli",
    vacancies: "Vakansiyalar",
    candidates: "Nomzodlar",
    aiSearch: "AI qidiruv",
    compare: "Taqqoslash",
    processing: "Qayta ishlash",
    settings: "Sozlamalar",
    findJobs: "Oddiy ish qidiruvi",
    externalAiJobs: "Tashqi AI ish o‘rinlari",
    internalAiJobs: "Ichki AI ish o‘rinlari",
    jobPreferences: "Istaklar",
    myApplications: "Mening arizalarim",
    interviewChats: "Suhbat chatlari",
    savedJobs: "Saqlangan vakansiyalar",
    myProfile: "Mening profilim",
    openNavigation: "Menyuni ochish",
    closeNavigation: "Menyuni yopish",
    breadcrumb: "Navigatsiya izi",
    notePersonal:
      "Profilingiz va arizalaringiz sizniki. Rekruterlar faqat siz yuborgan maʼlumotni koʻradi.",
    noteOrganization:
      "Saralash ham, rad javobi ham insonning qarori boʻlib qoladi. Kopilot faqat dalilni koʻrsatadi.",
    profile: "Profil",
    workspaceSettings: "Ish maydoni sozlamalari",
    signOut: "Chiqish",
    notifications: "Bildirishnomalar",
    notificationsUnavailable: "Bildirishnomalar hali mavjud emas",
    personal: "Shaxsiy",
    organizations: "Tashkilotlar",
    personalUnavailable:
      "Ish izlovchi profillari hali mavjud emas — API’da kiriladigan nomzod hisobi yoʻq.",
    multiOrganizationNote:
      "Bir nechta tashkilotga aʼzo boʻlish uchun API’da hali mavjud boʻlmagan aʼzolik modeli kerak.",
    oneOfOne: "1 / 1",
  },

  notifications: {
    title: "Bildirishnomalar",
    bellLabel: "Bildirishnomalarni ochish",
    bellUnreadLabel: "Bildirishnomalarni ochish, {count} ta oʻqilmagan",
    unread: "{count} ta oʻqilmagan",
    allCaughtUp: "Hammasi oʻqilgan",
    markAllRead: "Hammasini oʻqilgan qilish",
    loadMore: "Yana yuklash",
    noDestination: "Bogʻlangan sahifa yoʻq",
    empty: {
      hrTitle: "Rekruting bildirishnomalari yoʻq",
      hrDescription:
        "Arizalar, nomzod xabarlari va CV ishlov berish yangilanishlari shu yerda chiqadi.",
      candidateTitle: "Bildirishnomalar yoʻq",
      candidateDescription:
        "Xabarlar, suhbat takliflari va ariza yangilanishlari shu yerda chiqadi.",
    },
    errors: {
      load: "Bildirishnomalarni yuklab boʻlmadi.",
      markRead: "Bu bildirishnomani oʻqilgan qilib boʻlmadi.",
      markAll: "Bildirishnomalarni oʻqilgan qilib boʻlmadi.",
    },
    fallbacks: {
      candidateUnavailable: "Nomzod mavjud emas",
      vacancyUnavailable: "Vakansiya mavjud emas",
      recruiter: "Rekruter",
    },
    messages: {
      newMessageFallback: "Yangi xabar",
      interviewInvitation: "Siz suhbatga taklif qilindingiz.",
      vacancyDeleted: "Siz ariza topshirgan “{vacancy}” vakansiyasi o‘chirildi.",
      applicationRejected: "Jamoa keyingi bosqichga oʻtmaslikka qaror qildi.",
    },
    types: {
      NEW_APPLICATION: "Yangi ariza",
      NEW_MESSAGE: "Yangi xabar",
      INTERVIEW_INVITATION: "Suhbat taklifi",
      VACANCY_DELETED: "Vakansiya yangiligi",
      APPLICATION_REJECTED: "Ariza yangilanishi",
    },
  },

  auth: {
    candidate: "Nomzod",
    organization: "Tashkilot",
    chooseSignIn: "Qanday kirishni tanlang",
    chooseRegistration: "Hisob turini tanlang",
    chooseAccountTypeHint:
      "Nomzod va tashkilot hisoblari alohida. Hisobingizga mos kirish joyini tanlang.",
    candidateAuthHint:
      "Ish qidiring, arizalarni boshqaring, vakansiyalarni saqlang va AI ish tanlashdan foydalaning.",
    organizationAuthHint:
      "Vakansiyalar, nomzodlar, dalil qidiruvi va ishga qabul jarayonlarini boshqaring.",
    accountTypeExclusive:
      "Bitta email yoki Nomzod, yoki Tashkilot hisobi boʻlishi mumkin — ikkalasi emas.",
    signIn: "Kirish",
    candidateSignIn: "Nomzod sifatida kirish",
    organizationSignIn: "Tashkilot sifatida kirish",
    signingIn: "Kirilmoqda",
    signInSubtitle:
      "Tashkilotingiz ishga qabul jarayoniga ish hisobingiz bilan kiring.",
    candidateSignInSubtitle:
      "Ish qidirish va arizalarni boshqarish uchun nomzod hisobingizga kiring.",
    organizationSignInSubtitle:
      "Ishga qabul ish maydonlarini boshqarish uchun tashkilot hisobingizga kiring.",
    createAccount: "Ish maydoni yaratish",
    createCandidateAccount: "Nomzod hisobini yaratish",
    createOrganizationAccount: "Tashkilot hisobini yaratish",
    createAccountSubtitle:
      "Tashkilot oching va uning birinchi administratori boʻling.",
    email: "Email",
    emailPlaceholder: "you@company.com",
    password: "Parol",
    fullName: "Toʻliq ism",
    organizationName: "Tashkilot nomi",
    organizationSlug: "Ish maydoni manzili",
    showPassword: "Parolni koʻrsatish",
    hidePassword: "Parolni yashirish",
    noAccount: "Hisobingiz yoʻqmi?",
    createOne: "Yaratish",
    haveAccount: "Hisobingiz bormi?",
    signInInstead: "Kirish",
    couldNotSignIn: "Kirib boʻlmadi.",
    couldNotRegister: "Ish maydoni yaratilmadi.",
    candidateAccountUseCandidateSignIn:
      "Bu nomzod hisobi. Nomzod kirish sahifasi orqali kiring.",
    organizationAccountUseOrganizationSignIn:
      "Bu hisob tashkilotga tegishli. Tashkilot kirish sahifasi orqali kiring.",
    emailAlreadyRegistered: "Bu email allaqachon roʻyxatdan oʻtgan. Kirib koʻring.",
    emailBelongsToCandidate:
      "Bu email allaqachon nomzod hisobi sifatida roʻyxatdan oʻtgan.",
    emailBelongsToOrganization:
      "Bu email allaqachon tashkilot hisobi sifatida roʻyxatdan oʻtgan.",
    creating: "Yaratilmoqda",
    heroTitle: "Har bir rezyumeni oʻqimasdan, har birini puxta oʻqing.",
    heroPoints: [
      "Har bir ajratib olingan maʼlumot oʻzi olingan sahifaga bogʻlanadi.",
      "Butun jarayon boʻylab rezyumelarni oddiy tilda qidiring.",
      "Saralash va rad javobi doim insonning qarori boʻlib qoladi.",
    ],
  },

  validation: {
    emailRequired: "Email manzilini kiriting.",
    workEmailRequired: "Ish emailini kiriting.",
    emailInvalid: "Toʻgʻri email manzilini kiriting.",
    passwordRequired: "Parolni kiriting.",
    passwordMinLength: "Kamida {min} ta belgi ishlating.",
    fullNameRequired: "Toʻliq ismni kiriting.",
    fullNameShort: "Ism va familiyangizni toʻliq kiriting.",
    organizationNameRequired: "Kompaniya yoki tashkilot nomini kiriting.",
    slugRequired: "Ish maydoni manzilini kiriting.",
    slugPattern: "Faqat kichik lotin harflari, raqamlar va defis ishlating.",
    emailInUse: "Bu email manzili allaqachon band.",
    websiteUrlInvalid: "http:// yoki https:// bilan boshlanadigan to‘g‘ri URL kiriting.",
  },

  register: {
    subtitle: "Tashkilotingizni ochadi va sizni uning egasi qiladi.",
    candidateSubtitle:
      "Ish izlovchi hisobini yarating. Kompaniya yoki ish maydoni kerak emas.",
    organizationSubtitle: "Tashkilotingizni ochadi va sizni uning egasi qiladi.",
    fullNamePlaceholder: "Aziza Rahimova",
    workEmail: "Ish emaili",
    workEmailPlaceholder: "aziza@company.com",
    organizationLabel: "Kompaniya yoki tashkilot",
    organizationPlaceholder: "Northwind Talent",
    slugLabel: "Ish maydoni manzili",
    slugPlaceholder: "northwind-talent",
    slugHint: "Kichik harflar, raqamlar va defis. Takrorlanmasligi kerak.",
    preferredLanguage: "Afzal til",
    passwordPlaceholder: "Kamida {min} ta belgi",
    passwordHint: "Kamida {min} ta belgi.",
    submit: "Ish maydoni yaratish",
    submitCandidate: "Nomzod hisobini yaratish",
    submitOrganization: "Tashkilot hisobini yaratish",
    submitting: "Ish maydoni yaratilmoqda",
    submittingCandidate: "Nomzod hisobi yaratilmoqda",
    submittingOrganization: "Tashkilot hisobi yaratilmoqda",
  },

  dashboard: {
    title: "Boshqaruv paneli",
    description: "Ishga qabul jarayonining hozirgi holati.",
    newVacancy: "Yangi vakansiya",
    statTotalCandidates: "Jami nomzodlar",
    statTotalCandidatesHint: "Ushbu ish maydonidagi barcha vakansiyalar boʻyicha",
    statActiveVacancies: "Faol vakansiyalar",
    statActiveVacanciesHint: "Ochiq va nomzod qabul qilmoqda",
    statResumesProcessing: "Qayta ishlanayotgan rezyumelar",
    statResumesProcessingHint: "Tahlil → indekslash jarayonida",
    statCompletedAnalyses: "Yakunlangan tahlillar",
    statCompletedAnalysesHint: "Indekslangan va oʻqishga tayyor hujjatlar",
    quickCreateVacancy: "Vakansiya yaratish",
    quickCreateVacancyHint: "Kopilot qidiradigan talablarni belgilang.",
    quickReviewApplicants: "Arizalarni koʻrish",
    quickReviewApplicantsHint:
      "Vakansiyalaringizga kim ariza topshirganini koʻring.",
    recentVacancies: "Soʻnggi vakansiyalar",
    recentCandidates: "Soʻnggi nomzodlar",
    processingActivity: "Qayta ishlash holati",
    processingActivityHint: "Har bir bosqichga yetgan hujjatlar",
    latestProcessing: "Soʻnggi jarayonlar",
    latestProcessingHint: "Eng yangi vazifalar",
    openProcessingQueue: "Qayta ishlash navbatini ochish",
    noVacancies: "Hali vakansiya yoʻq",
    noVacanciesHint:
      "Kopilotga nimani qidirishni bildirish uchun birinchi vakansiyani yarating.",
    noCandidates: "Hali ariza yoʻq",
    noCandidatesHint:
      "Vakansiyalaringizga ariza topshirgan nomzodlar shu yerda koʻrinadi.",
    nothingProcessed: "Hali hech narsa qayta ishlanmadi",
    nothingProcessedHint:
      "Yuklangan hujjatlar jarayondan oʻtar ekan shu yerda koʻrinadi.",
    noDepartment: "Boʻlim koʻrsatilmagan",
    noLocation: "Manzil koʻrsatilmagan",
    document: "Hujjat",
  },

  vacancies: {
    title: "Vakansiyalar",
    description:
      "Siz odam qidirayotgan barcha lavozimlar va har bir rezyume tekshiriladigan talablar.",
    create: "Vakansiya yaratish",
    createTitle: "Vakansiya yaratish",
    createDescription:
      "Talablar har bir rezyume tekshiriladigan mezondir — ularni soʻrayotgandek yozing.",
    searchPlaceholder: "Vakansiyalarni qidirish",
    filterStatus: "Holat",
    filterDepartment: "Boʻlim",
    allStatuses: "Barcha holatlar",
    allDepartments: "Barcha boʻlimlar",
    empty: "Hali vakansiya yoʻq",
    emptyHint:
      "Kopilotga nimani qidirishni bildirish uchun birinchi vakansiyani yarating.",
    noMatches: "Mos vakansiya topilmadi",
    noMatchesHint: "Koʻproq lavozim koʻrish uchun filtrni olib tashlang.",
    requirements: "Talablar",
    requirement: "Talab",
    addRequirement: "Talab qoʻshish",
    removeRequirement: "Talabni oʻchirish",
    noRequirements: "Bu vakansiyada hali talablar yoʻq",
    noRequirementsHint:
      "Talab qoʻshing — har biri barcha nomzodlarning hujjatlari bilan solishtiriladi.",
    fieldTitle: "Lavozim nomi",
    fieldDepartment: "Boʻlim",
    fieldLocation: "Manzil",
    fieldEmploymentType: "Bandlik turi",
    fieldExperienceLevel: "Tajriba darajasi",
    fieldDescription: "Tavsif",
    requirementText: "Talab matni",
    requirementType: "Turi",
    requirementRequired: "Majburiy",
    candidatesOnVacancy: "Nomzodlar",
    viewCandidates: "Nomzodlarni koʻrish",
    compareCandidates: "Nomzodlarni taqqoslash",
    notFound: "Vakansiya topilmadi",
    notFoundHint: "Bunday vakansiya yoʻq yoki u boshqa tashkilotga tegishli.",
    backToVacancies: "Vakansiyalar roʻyxatiga",
  },

  candidates: {
    title: "Nomzodlar",
    description:
      "Jarayondagi barcha nomzodlar va ularning hujjat holati. Model hech kimni saralamaydi va tartiblamaydi.",
    searchPlaceholder: "Nomzodlarni qidirish",
    filterVacancy: "Vakansiya",
    allVacancies: "Barcha vakansiyalar",
    sortBy: "Saralash",
    sortRecent: "Eng yangi",
    sortName: "Ism boʻyicha",
    sortExperience: "Tajriba boʻyicha",
    empty: "Hali nomzod yoʻq",
    emptyHint: "Nomzod qoʻshing va rezyumesini yuklab jarayonni boshlang.",
    noMatches: "Mos nomzod topilmadi",
    noMatchesHint: "Koʻproq nomzod koʻrish uchun filtrni olib tashlang.",
    overview: "Nomzod haqida",
    currentTitle: "Joriy lavozim",
    experience: "Tajriba",
    location: "Manzil",
    email: "Email",
    phone: "Telefon",
    added: "Birinchi ariza",
    documents: "Hujjatlar",

    // Dalil manbalari — fayllar va professional havolalar. HR uchun faqat oʻqish.
    currentEvidence: "Nomzodning joriy maʼlumotlari",
    currentEvidenceHint:
      "Nomzodning hozirgi profili, fayllari va havolalari — topshirilgan payt emas, ayni hozirgi holat.",
    currentEvidenceEmpty: "Nomzodda hozircha fayl yoki havola yoʻq.",
    currentDocuments: "Hujjatlar",
    currentLinks: "Professional havolalar",
    currentEvidenceDocument: "Hujjat",
    openCurrentFile: "Ochish",
    openOriginalLink: "Asl manbani ochish",
    noSource: "Manba tanlanmagan",
    noSourceHint: "Nima yuborilganini koʻrish uchun fayl yoki havolani tanlang.",
    originalUrl: "Asl havola",
    openOriginal: "Aslini ochish",
    applications: "Arizalar",
    applicationsHint: "Bosqich oʻzgarishi uni bajargan xodim bilan qayd etiladi.",
    profile: "Profil",
    application: "Ariza",
    attempts: "Arizalar soni",
    appliedAt: "Ariza sanasi",
    currentStatus: "Joriy holat",
    otherVacancies: "Boshqa vakansiyalar",
    otherVacanciesHint:
      "Bu nomzod ishtirok etayotgan boshqa jarayonlar. Har birining bosqichi mustaqil.",
    noApplicationForVacancy: "Bu vakansiyaga ariza yoʻq",
    applicationStage: "Ariza bosqichi",
    notAttached: "Vakansiyaga bogʻlanmagan",
    notAttachedHint:
      "Hujjatlarini vakansiya talablari bilan solishtirish uchun nomzodni vakansiyaga bogʻlang.",
    appliedOn: "{date} da ariza berdi",
    vacancy: "Vakansiya",
    updateFailed: "Yangilab boʻlmadi.",
    couldNotUpdate: "Arizani yangilab boʻlmadi.",
    notFound: "Nomzod topilmadi",
    notFoundHint: "Bunday nomzod yoʻq yoki u boshqa tashkilotga tegishli.",
    backToCandidates: "Nomzodlar roʻyxatiga",
    fieldFullName: "Toʻliq ism",
    fieldEmail: "Email",
    fieldPhone: "Telefon",
    fieldLocation: "Manzil",
    fieldCurrentTitle: "Joriy lavozim",
    fieldExperienceYears: "Tajriba (yil)",
    tabOverview: "Umumiy",
    tabEvidence: "Talab dalillari",
    tabSummary: "AI xulosa",
    tabQuestions: "Intervyu savollari",
    tabAsk: "Savol berish",
    noDocument: "Hujjat yoʻq",
    noDocumentHint:
      "Shu yerda oʻqish uchun ushbu nomzodning rezyumesini yuklang.",
    selectDocument: "Hujjatni tanlash",
    documentOpenFailed: "Hujjat ochilmadi. Birozdan soʻng qayta urinib koʻring.",
    previewUnavailable: "PDF oldindan koʻrish bu yerda koʻrsatilmadi.",
    openPdf: "PDF’ni ochish",
    docxNotRenderable:
      "Brauzerlar DOCX’ni sahifa ichida koʻrsata olmaydi. Faylni alohida oching — ajratilgan matn va manbalar yonida qoladi.",
    openFile: "{name} faylini ochish",
    showingCitation: "Manba koʻrsatilmoqda",
    noDocuments: "Hujjat yoʻq",
  },

  upload: {
    title: "Rezyume yuklash",
    dropHere: "Rezyumelarni shu yerga tashlang",
    browse: "Fayl tanlash",
    hint: "PDF yoki DOCX, {size} gacha.",
    unsupportedType: "{name} PDF yoki DOCX fayli emas.",
    tooLarge: "{name} hajmi {size} dan katta.",
    uploading: "Yuklanmoqda",
    uploadFailed: "Yuklab boʻlmadi",
    remove: "Oʻchirish",
    unattachedNote:
      "Bu yerdan yuklangan fayllar nomzodsiz saqlanadi. Vakansiya talablari bilan solishtirish uchun nomzod sahifasidan yuklang.",
    errorCodes: {
      FILE_TOO_LARGE: "Fayl 50 MB cheklovidan katta.",
      UNSUPPORTED_FILE_TYPE: "PDF yoki DOCX fayl yuklang.",
      PERSONAL_DOCUMENT_LIMIT_REACHED:
        "3 tagacha hujjat saqlash mumkin. Boshqasini yuklash uchun bittasini oʻchiring.",
    },
  },

  search: {
    title: "AI nomzod qidiruvi",
    description:
      "Oddiy tilda soʻrang. Har bir natija oʻzi olingan parcha, hujjat va sahifa bilan koʻrsatiladi.",
    label: "Rezyume dalillarini qidirish",
    placeholder:
      "Nimani qidirayotganingizni yozing — masalan: Kubernetes’ni prodda boshqargan va navbatchilikni olib borgan",
    hint: "Qidirish uchun Enter · yangi qator uchun Shift + Enter",
    submit: "Qidirish",
    minLength: "Qidirish uchun kamida ikkita belgi kiriting.",
    examples: [
      "Prodda Kubernetes bilan ishlash tajribasi",
      "Hodisalarni tarqatish uchun Redis Pub/Sub",
      "Ichki xizmatlar uchun GraphQL sxemasi loyihalash",
      "Monolitdan xizmatlarga oʻtishni boshqargan",
    ],
    resultsCount: {
      one: "{count} nomzodda mos parchalar topildi",
      other: "{count} nomzodda mos parchalar topildi",
    },
    reranked: "Qayta tartiblangan",
    considered: "{count} ta koʻrib chiqildi · {ms} ms",
    noResults: "Tasdiqlovchi parcha topilmadi",
    noResultsHint:
      "Indekslangan hujjatlarda bunga mos maʼlumot yoʻq. Boshqacha ifodalab koʻring yoki rezyumelar qayta ishlanib boʻlganini tekshiring.",
    unavailable: "Qidiruv vaqtincha ishlamayapti",
    unavailableHint:
      "Qidiruv ortidagi xizmatga hozir ulanib boʻlmayapti, shuning uchun natija koʻrsatilmaydi. Bu «hech narsa topilmadi» degani emas — birozdan soʻng qayta urinib koʻring.",
    failed: "Qidiruv bajarilmadi. Birozdan soʻng qayta urinib koʻring.",
    orderingNote:
      "Nomzodlar eng mos parchasi tartibida koʻrsatiladi. Bu matnning soʻrovga qanchalik mos kelganini bildiradi — insonga qoʻyilgan baho ham, ishga olish tavsiyasi ham emas.",
    retrievalContext: "Qidiruv konteksti",
    unnamedCandidate: "Ismi koʻrsatilmagan nomzod",
    sourceDocument: "Manba hujjat",
    sourceLink: "Professional havola",
    summaryTitle: "AI xulosasi",
    searchingEvidence: "Nomzod dalillari qidirilmoqda…",
    generatingSummary: "Dalilga asoslangan xulosa tayyorlanmoqda…",
  },

  ai: {
    ask: "Ushbu nomzod haqida savol berish",
    askDescription:
      "Javob faqat yuklangan hujjatlardagi parchalar asosida yoziladi va har biri manbasi bilan koʻrsatiladi.",
    askPlaceholder:
      "Nomzodning hujjatlari boʻyicha savol bering — masalan: oxirgi ish joyida nimaga javob bergan?",
    askLabel: "Dalilga asoslangan savol",
    askSubmit: "Soʻrash",
    generating: "Yaratilmoqda",
    generatingAnswer: "Hujjatlar oʻqilmoqda va javob yozilmoqda…",
    answer: "Javob",
    answerLocale: "Javob tili",
    citations: "Manbalar",
    citationsCount: {
      one: "{count} manba",
      other: "{count} manba",
    },
    noCitations: "Ushbu javob bilan birga manba parchalari qaytmadi.",
    supportingEvidence: "Tasdiqlovchi dalil",
    viewOriginalEvidence: "Asl matnni koʻrsatish",
    hideOriginalEvidence: "Asl matnni yashirish",
    sectionLabels: {
      summary: "Qisqacha maʼlumot",
      experience: "Ish tajribasi",
      projects: "Loyihalar",
      skills: "Koʻnikmalar",
      education: "Taʼlim",
      certifications: "Sertifikatlar",
      languages: "Tillar",
    },
    citationSourcesUnavailable:
      "Javobda manbalarga havolalar bor, ammo ular bilan birga mos parchalar qaytarilmadi, shuning uchun havolalarni ochib boʻlmaydi. Daʼvolarni bevosita hujjatlar orqali tekshiring.",
    evidenceConsidered: "{count} ta parcha koʻrib chiqildi",
    model: "Model",
    regenerate: "Qayta yaratish",
    generate: "Yaratish",
    minQueryLength: "Kamida uchta belgidan iborat savol bering.",

    summaryTitle: "Dalilga asoslangan xulosa",
    summaryDescription:
      "Nomzodning oʻz hujjatlarida yozilgan maʼlumot. Bu insonga berilgan baho emas, unda ball ham, tavsiya ham yoʻq.",
    summaryGenerate: "Xulosa yaratish",
    summaryRegenerate: "Qayta yaratish",
    summaryEmpty: "Hali xulosa yaratilmagan",
    summaryEmptyHint:
      "Xulosa yarating va indekslangan hujjatlarda nima yozilganini har bir fikr ortidagi manba bilan oʻqing.",

    questionsTitle: "Intervyu savollari",
    questionsDescription:
      "Hujjatlar nimani koʻrsatgani va nimani koʻrsatmaganidan kelib chiqqan, intervyu oluvchi uchun savollar. Bu baho ham, ball ham emas.",
    questionsGenerate: "Savollar yaratish",
    questionsRegenerate: "Qayta yaratish",
    questionsEmpty: "Hali savollar yaratilmagan",
    questionsEmptyHint:
      "Savollar yarating va nomzod dalillarini vakansiya talablari bilan solishtirgan savollarni oling.",
    questionReason: "Nega soʻraladi",
    questionsNoVacancy: "Avval nomzodni vakansiyaga bogʻlang",
    questionsNoVacancyHint:
      "Savollar vakansiya talablaridan kelib chiqadi, shuning uchun avval ariza kerak.",
    questionsNone: "Savollar qaytmadi",
    questionsNoneHint:
      "Hujjatlar ham, talablar ham soʻrashga arzigulik savol bermadi. Bu xato emas, natija.",

    mapTitle: "Talablar boʻyicha dalil xaritasi",
    mapDescription:
      "Vakansiyaning har bir talabi va hujjatlarda uni tasdiqlovchi maʼlumot.",
    mapRun: "Xaritalashni ishga tushirish",
    mapRerun: "Qayta ishga tushirish",
    mapRunning: "Talablar hujjatlar bilan solishtirilmoqda…",
    mapNotRun: "Dalil xaritalash hali ishga tushirilmagan",
    mapNotRunHint:
      "Xaritalashni ishga tushiring — vakansiyaning har bir talabi nomzodning indekslangan hujjatlari bilan solishtiriladi.",
    mapLastRun: "{date} da xaritalangan",
    mapNeverRun: "Ishga tushirilmagan",
    mapFoundCount: "{total} talabdan {found} tasida tasdiqlovchi dalil bor",
    mapCheckedAgainst: "«{vacancy}» boʻyicha tekshirildi",
    mapNoRequirements: "Bu vakansiyada hali talablar yoʻq",
    mapNoRequirementsHint:
      "Vakansiyaga talab qoʻshing — har biri nomzod hujjatlari bilan solishtiriladi.",
    mapMatchedTerms: "Mos keldi",
    mapMissingTerms: "Topilmadi",
    mapReason: "Sababi",
    mapForbidden:
      "Sizning rolingiz dalil xaritasini oʻqiy oladi, lekin uni ishga tushira olmaydi. Rekruter yoki administratordan soʻrang.",
    noOverallScore:
      "Umumiy moslik bali yoʻq. Har bir talab alohida koʻrsatiladi, xulosa esa sizda qoladi.",

    statusGroundedHint: "Quyidagi manba parchalari asosida yozilgan.",
    statusInsufficientHint:
      "Indekslangan hujjatlarda bunga javob berish uchun yetarli maʼlumot yoʻq. Boʻshliq hech narsa bilan toʻldirilmadi.",
    statusNeedsReviewHint:
      "Aloqador maʼlumot topildi, ammo uni inson baholashi kerak.",

    generationUnavailable: "AI generatsiyasi vaqtincha ishlamayapti",
    generationUnavailableHint:
      "AI generatsiyasi vaqtincha ishlamayapti. Dalil qidiruvi ishlashda davom etmoqda.",
    retrievalUnavailable: "Dalil qidiruvi vaqtincha ishlamayapti",
    retrievalUnavailableHint:
      "Indekslangan hujjatlarni oʻqiydigan xizmatga hozir ulanib boʻlmayapti, shuning uchun qidirish yoki iqtibos keltirish mumkin emas. Birozdan soʻng qayta urinib koʻring.",
    networkFailed: "Serverga ulanib boʻlmadi",
    networkFailedHint:
      "Soʻrov yetib bormadi. Internet aloqasini tekshirib, qayta urinib koʻring.",
    noEvidence: "Dalil topilmadi",
    noEvidenceHint:
      "Indekslangan hujjatlarda buni tasdiqlovchi maʼlumot yoʻq. Bu hujjatlar haqidagi natija, nomzod haqidagi hukm emas.",
    notProcessed: "Hali birorta hujjat qayta ishlanmagan",
    notProcessedHint:
      "AI imkoniyatlari indekslangan hujjatlarni oʻqiydi. Rezyume yuklang va qayta ishlash tugashini kuting.",
    stillProcessing: "Hujjatlar hali qayta ishlanmoqda",
    stillProcessingHint:
      "Barcha hujjatlar indekslangach AI imkoniyatlari ochiladi.",
    processingFailed: "Hujjatni qayta ishlab boʻlmadi",
    processingFailedHint:
      "Ushbu nomzodning hujjatlari qayta ishlanmadi, shuning uchun oʻqiladigan narsa yoʻq. Sababini qayta ishlash navbatidan koʻring.",
    notLinked: "Bu nomzod vakansiyaga bogʻlanmagan",
    notLinkedHint:
      "Talab xaritalash ham, intervyu savollari ham solishtirish uchun vakansiya talab qiladi.",
    citationSourceLanguageNote:
      "Iqtibos keltirilgan parchalar asl hujjat tilida qoladi.",
  },

  evidence: {
    title: "Talab dalillari",
    requirementsSummary: "{total} talabdan {found} tasida tasdiqlovchi dalil bor",
    checkedAgainst: "«{vacancy}» boʻyicha tekshirildi",
    noVacancy: "Vakansiya bogʻlanmagan",
    noVacancyHint:
      "Hujjatlarini vakansiya talablari bilan solishtirish uchun nomzodni vakansiyaga bogʻlang.",
    noDocuments: "Oʻqiladigan hujjat yoʻq",
    noDocumentsHint:
      "Talab dalillari yuklangan fayllardan olinadi. Rezyume yuklashdan boshlang.",
    analysisRunning: "Tahlil hali davom etmoqda",
    analysisRunningHint:
      "Barcha hujjatlar indekslangach talab dalillari koʻrinadi.",
    processingFailed: "Hujjatni qayta ishlab boʻlmadi",
    processingFailedHint:
      "Ushbu nomzodning hujjatlari qayta ishlanmadi, shuning uchun koʻrsatiladigan dalil yoʻq. Sababini qayta ishlash navbatidan koʻring.",
    nothingSupports:
      "Yuklangan hujjatlarda bu talabni tasdiqlovchi maʼlumot yoʻq. Bu nomzodga qoʻyilgan hukm emas — intervyuda soʻrang.",
    openAtPage: "{name} faylini {page}-sahifada ochish",
    openDocument: "{name} faylini ochish",
    openSource: "{name} ni ochish",
  },

  processing: {
    title: "Qayta ishlash",
    description:
      "Yuklangan barcha hujjatlar va ularning tahlil → indekslash jarayonidagi oʻrni.",
    pipeline: "Jarayon",
    ingested: {
      one: "{count} hujjat qabul qilindi",
      other: "{count} hujjat qabul qilindi",
    },
    searchPlaceholder: "Fayl yoki nomzodni qidirish",
    searchLabel: "Qayta ishlash navbatini qidirish",
    filterState: "Holat boʻyicha filtr",
    allStates: "Barcha holatlar",
    shownOfTotal: "{total} tadan {shown} ta",
    workInProgress: " · ish davom etmoqda",
    columnDocument: "Hujjat",
    columnProgress: "Bajarilishi",
    columnAttempts: "Urinishlar",
    columnUpdated: "Yangilangan",
    columnState: "Holat",
    caption: "Qayta ishlash navbati",
    notLinked: "Nomzodga bogʻlanmagan",
    queueEmpty: "Navbat boʻsh",
    queueEmptyHint:
      "Rezyume yuklang — u tahlil, boʻlaklash, vektorlash va indekslash bosqichlaridan oʻtadi.",
    noMatches: "Mos natija yoʻq",
    noMatchesHint: "Koʻproq vazifa koʻrish uchun filtrni olib tashlang.",
    retryNote:
      "Bajarilmagan vazifa sababi koʻrinib turishi uchun xatosini saqlaydi. API qayta urinish endpointini bermagani uchun bu yerda tugma yoʻq — faylni qaytadan yuklang.",
    queueEmptyShort: "Qayta ishlash navbatida hech narsa yoʻq.",
    failed: "Xatolik",
    progressLabel: "{name} bajarilishi",
    stageLabel: "{stage}: {total} tadan {reached} ta",
  },

  compare: {
    title: "Nomzodlarni taqqoslash",
    description:
      "Talablar boʻyicha dalillarni yonma-yon qoʻying — har bir katak ortida manba parchasi bilan.",
    selectTitle: "Nomzodlarni tanlash",
    selectDescription: "Bitta vakansiyadan {min}–{max} ta nomzod tanlang.",
    selectedCount: "{count} / {max}",
    vacancy: "Vakansiya",
    vacancyOption: "{title} ({count})",
    nothingToCompare: "Hali taqqoslash uchun maʼlumot yoʻq",
    nothingToCompareHint:
      "Vakansiyada rezyumesi indekslangan nomzodlar paydo boʻlgach, ularning talab dalillarini yonma-yon qoʻyish mumkin.",
    noneProcessed:
      "Bu vakansiyaning birorta nomzodi hali qayta ishlanib boʻlmadi.",
    processedRatio:
      "Bu vakansiyadagi {total} nomzoddan {ready} tasi qayta ishlandi. Qolganlari hujjatlari indekslangach koʻrinadi.",
    selectAtLeast: "Kamida {min} ta nomzod tanlang",
    selectAtLeastHint:
      "Taqqoslash har bir nomzod hujjatlaridagi talab dalillarini yonma-yon qoʻyadi.",
    tableCaption: "«{vacancy}» boʻyicha talab dalillari",
    columnRequirement: "Talab",
    legendTitle: "Kataklar nimani bildiradi",
    legendFound: "Hujjatdagi parcha bu talabni tasdiqlaydi.",
    legendNotFound:
      "Hujjatlarda bu haqda hech narsa yoʻq. Dalil yoʻqligi — yoʻqlikning isboti emas.",
    legendReview: "Aloqador maʼlumot topildi, ammo uni inson baholashi kerak.",
    legendNotRun:
      "Ushbu nomzod va vakansiya uchun dalil xaritalash hali ishga tushirilmagan.",
    noWinner:
      "Bu jadval hujjatlar mazmunini taqqoslaydi. U nomzodlarni tartiblamaydi va ishga olishni tavsiya qilmaydi — qaror sizda qoladi.",
    couldNotBuild: "Taqqoslashni tuzib boʻlmadi.",
    runMapping: "Tanlangan nomzodlar uchun xaritalashni ishga tushirish",
    mappingRunning: "Dalil xaritalash bajarilmoqda…",
    unmappedNote:
      "Tanlangan nomzodlardan {count} tasida bu vakansiya boʻyicha saqlangan dalil xaritasi yoʻq. Ustunlarni toʻldirish uchun xaritalashni ishga tushiring.",
  },

  /**
   * The caller's own account — shared by the recruiter settings screen and
   * the job seeker's profile, because both edit the same three fields.
   */
  account: {
    title: "Hisobingiz",
    description: "Ismingiz, kirish manzili va profil rasmi.",
    fullName: "To‘liq ism",
    email: "Email",
    emailHint: "Bu manzil orqali tizimga kirasiz.",
    uploadPhoto: "Rasm yuklash",
    changePhoto: "Rasmni almashtirish",
    removePhoto: "Rasmni o‘chirish",
    photoHint: "PNG, JPEG yoki WebP, 5 MB gacha. Ixtiyoriy — rasmsiz bosh harflaringiz ko‘rinadi.",
    saveChanges: "O‘zgarishlarni saqlash",
    saveFailed: "Profilni saqlab bo‘lmadi.",
    photoFailed: "Rasmni yangilab bo‘lmadi.",
    imageTypeError: "Bu fayl qo‘llab-quvvatlanadigan rasm emas. PNG, JPEG yoki WebP ishlating.",
    imageTooLarge: "Rasm juda katta. Chegara — 5 MB.",
  },

  settings: {
    title: "Sozlamalar",
    description: "Profilingiz, tashkilot va kimda ruxsat borligi.",
    tabProfile: "Profil",
    tabOrganization: "Tashkilot",
    tabTeam: "Jamoa",
    tabIntegrations: "Integratsiyalar",
    tabSecurity: "Xavfsizlik",
    tabLanguage: "Til",
    yourProfile: "Sizning profilingiz",
    yourProfileHint: "Ish maydonidagi boshqalar sizni qanday koʻradi.",
    fullName: "Toʻliq ism",
    email: "Email",
    organization: "Tashkilot",
    organizationHint: "Ushbu ish maydonidagi hammaga taalluqli.",
    organizationName: "Tashkilot nomi",
    workspaceUrl: "Ish maydoni manzili",
    slugLocked: "Manzilni oʻzgartirish mavjud havolalarni buzadi.",
    countMembers: "Aʼzolar",
    countVacancies: "Vakansiyalar",
    countCandidates: "Nomzodlar",
    countDocuments: "Hujjatlar",
    team: "Jamoa",
    teamAccess: {
      one: "{count} kishi ushbu ish maydoniga kira oladi.",
      other: "{count} kishi ushbu ish maydoniga kira oladi.",
    },
    inviteNote:
      "API hamkasblarni email taklifi orqali emas, administrator belgilagan parol bilan yaratadi, shuning uchun bu yerda taklif jarayoni yoʻq.",
    integrations: "Integratsiyalar",
    integrationsHint:
      "Arizalarni email va ish e’lonlari saytlaridan oling — barcha manbalar bitta jarayonga tushsin.",
    integrationsUnavailable:
      "Hozircha hech birini ulab boʻlmaydi — API’da integratsiya endpointlari ham, maʼlumot saqlash joyi ham yoʻq. Ular koʻzda tutilgan shaklni koʻrsatish uchun sanab oʻtilgan; bu yerda hech narsa mavjud boʻlmagan ulanishni bor deb koʻrsatmaydi.",
    connect: "Ulash",
    security: "Xavfsizlik",
    sessionHandling: "Sessiya boshqaruvi",
    sessionHandlingHint:
      "Sessiyangiz brauzer skriptlari oʻqiy olmaydigan cookie’da saqlanadi. Chiqish uni tozalaydi; API’da bekor qilish endpointi yoʻqligi sababli tokenning oʻzi muddati tugagunicha amal qiladi.",
    role: "Rol",
    workspaceCreated: "Ish maydoni yaratilgan",
    changePassword: "Parolni oʻzgartirish",
    enableTwoFactor: "Ikki bosqichli autentifikatsiyani yoqish",
    disabledNote:
      "API buni hali taqdim etmagani uchun oʻchirilgan. Taqdim etilmaguncha ular hech narsa qilmaydi.",
    couldNotSave: "Saqlab boʻlmadi.",
    languageTitle: "Til",
    languageHint:
      "Interfeys tilini va AI javoblari yoziladigan tilni belgilaydi. Iqtibos keltirilgan rezyume parchalari asl tilida qoladi.",
    languageStoredLocally:
      "Tanlovingiz shu brauzerda saqlanadi. Hisobingizda saqlangan til bor va u ushbu sozlamani koʻrmagan qurilmada ishlatiladi, ammo API’da bu tilni oʻzgartiradigan maydon yoʻq — shuning uchun bu yerdagi oʻzgarish boshqa qurilmaga oʻtmaydi.",
    organizationUrl: "Tashkilot URL manzili",
    organizationUrlPlaceholder: "https://northwind.example",
    organizationUrlHint: "Ixtiyoriy. Ish maydonida ko‘rsatiladi; o‘chirish uchun bo‘sh qoldiring.",
  },

  personal: {
    findJobs: "Ish topish",
    findJobsDescription:
      "Ochiq lavozimlarni koʻring va profilingizdagi rezyume bilan ariza yuboring.",
    findJobsUnavailable: "Vakansiya qidiruvi hali ochilmagan",
    findJobsUnavailableHint:
      "Hozir vakansiyalar har bir tashkilot ichida yashaydi va faqat oʻsha tashkilot jamoasiga koʻrinadi. Ommaviy roʻyxat yoʻq, uni oʻylab topish esa hech kim ariza bera olmaydigan lavozimlarni koʻrsatgan boʻlardi.",
    findJobsRequires: [
      "Faqat OPEN holatidagi lavozimlarni tashkilot nomi bilan qaytaradigan ommaviy endpoint — ichki qoralama va arxiv e’lonlarisiz",
      "Havolani ish maydonidan tashqarida ulashish uchun har bir vakansiyaga barqaror ommaviy identifikator",
    ],
    jobDetail: "Vakansiya tafsiloti",
    job: "Vakansiya",
    jobUnavailable: "Bu vakansiyani hali ommaga koʻrsatib boʻlmaydi",
    jobUnavailableHint:
      "Vakansiyani oʻqish uni e’lon qilgan tashkilotga aʼzolikni talab qiladi, shuning uchun ish izlovchi ocha oladigan narsa yoʻq. Ariza jarayoni ham xuddi shu shartnomaga bogʻliq.",
    jobRequires: [
      "Faqat lavozim nomi, tavsif, talablar, manzil va bandlik turini ochadigan ommaviy vakansiya endpointi",
      "Tizimga kirgan ish izlovchi oʻzi ariza bera oladigan endpoint",
    ],
    myApplications: "Mening arizalarim",
    myApplicationsDescription:
      "Siz ariza bergan barcha lavozimlar va ularning holati.",
    myApplicationsUnavailable:
      "Arizalar inson emas, tashkilot boʻyicha yuritiladi",
    myApplicationsUnavailableHint:
      "Hozir ariza bitta tashkilot ichidagi, rekruterga tegishli nomzod yozuviga ishora qiladi. Bu yozuvlarni ariza bergan odam bilan bogʻlaydigan maʼlumot yoʻq, shuning uchun «mening arizalarim»ni koʻrishning imkoni yoʻq.",
    myApplicationsRequires: [
      "Tizimga kirgan foydalanuvchiga tegishli CandidateAccount",
      "Ish izlovchi tashkilotga aʼzo boʻlmasdan oʻz arizalarini koʻrishi uchun Application’ni shu hisob bilan bogʻlash",
    ],
    stagesTitle: "Bosqichlar qanday oʻqiladi",
    stagesHint:
      "Har bir bosqich oʻtishini rekruter bajaradi — bu yerda hech narsa oʻzi harakatlanmaydi.",
    myProfile: "Mening profilim",
    myProfileDescription: "Ariza berganingizda rekruterlar nimani koʻradi.",
    myProfileUnavailable: "Hali tahrirlanadigan ish izlovchi profili yoʻq",
    myProfileUnavailableHint:
      "Siz {email} sifatida kirgansiz, ammo bu hisob faqat ishga qabul qiluvchi tashkilot aʼzosi sifatida mavjud. Ish izlovchi profili — sarlavha, koʻnikmalar, tajriba, taʼlim, tillar va asosiy rezyume — saqlanadigan joy yoʻq.",
    myProfileRequires: [
      "Rekruterga tegishli Candidate yozuvidan alohida, foydalanuvchiga tegishli CandidateAccount modeli",
      "Ushbu profilni egasi sifatida oʻqish va yangilash endpointlari",
      "Ish izlovchi oʻzini kim koʻrishini boshqarishi uchun profil koʻrinishi sozlamasi",
    ],
    savedJobs: "Saqlangan vakansiyalar",
    savedJobsDescription: "Keyinroq qaytmoqchi boʻlgan lavozimlaringiz.",
    savedJobsUnavailable: "Vakansiyani saqlash hali mavjud emas",
    savedJobsUnavailableHint:
      "Saqlangan lavozimlar qurilmalar oʻrtasida — keyinchalik mobil ilovada ham — sizga ergashishi uchun hisobingizga tegishli boʻlishi kerak. Ularni shu brauzer xotirasida saqlash boshqa joyda kirguningizcha ishlayotgandek koʻrinardi.",
    savedJobsRequires: [
      "CandidateAccount’dagi saqlangan vakansiyalar toʻplami",
      "Vakansiyani saqlash, roʻyxatini olish va oʻchirish endpointlari",
    ],
  },

  errors: {
    somethingWentWrong: "Nimadir xato ketdi",
    pageLoadFailed:
      "Sahifani yuklab boʻlmadi. Odatda qayta urinish yordam beradi.",
    notFoundTitle: "Sahifa topilmadi",
    notFoundHint:
      "Siz izlagan sahifa {app} tarkibida yoʻq yoki boshqa joyga koʻchirilgan.",
    goToDashboard: "Boshqaruv paneliga oʻtish",
    waitingOn: "Nima kutilmoqda",
    validation: "Belgilangan maydonlarni tekshirib, qayta urinib koʻring.",
    unauthorized: "Sessiyangiz tugadi. Davom etish uchun qaytadan kiring.",
    forbidden: "Rolingiz bu amalni bajarishga ruxsat bermaydi.",
    notFound: "Siz izlagan narsani topa olmadik.",
    conflict: "Bu allaqachon mavjud yozuv bilan toʻqnashadi.",
    rateLimited: "Urinishlar juda koʻp. Biroz kutib, qayta urinib koʻring.",
    server: "Bizning tomonda xatolik yuz berdi. Birozdan soʻng urinib koʻring.",
    network:
      "Serverga ulanib boʻlmadi. Internet aloqasini tekshirib, qayta urinib koʻring.",
    unavailable:
      "Bu xizmat vaqtincha ishlamayapti. Birozdan soʻng urinib koʻring.",
  },

  integrations: {
    groupEmail: "Email",
    groupEmailHint:
      "Email ilovasi sifatida keladigan arizalarni yuklangan rezyumelar bilan bir xil jarayonga oling.",
    groupJobBoards: "Ish e’lonlari saytlari",
    groupJobBoardsHint:
      "Nomzodlarni ish e’lonlari saytlaridan qabul qiling — barcha manbalar bitta jarayonga tushsin.",
    gmail: "Umumiy ishga qabul pochtasidan arizalarni oʻqish.",
    outlook: "Microsoft 365 ishga qabul pochtasidan arizalarni oʻqish.",
    saramin: "Koreya ish e’lonlari sayti.",
    wanted: "Koreya IT ishga qabul platformasi.",
    jobkorea: "Koreya ish e’lonlari sayti.",
    jumpit: "Koreya dasturchilar uchun ishga qabul platformasi.",
    linkedin:
      "Faqat LinkedIn hamkorlik dasturi orqali mumkin — mahsulot yopiq endpointlarni skreyping qilmaydi va taqlid qilmaydi.",
    indeed:
      "Faqat Indeed hamkorlik dasturi orqali, xuddi shu shartlarda mumkin.",
  },

  tables: {
    vacancy: "Vakansiya",
    candidate: "Nomzod",
    department: "Boʻlim",
    location: "Manzil",
    type: "Turi",
    status: "Holat",
    candidates: "Nomzodlar",
    created: "Yaratilgan",
    experience: "Tajriba",
    documents: "Hujjatlar",
    processing: "Qayta ishlash",
    updated: "Yangilangan",
    empty: "—",
    locationNotSet: "Manzil koʻrsatilmagan",
    noVacancyAssigned: "Vakansiya biriktirilmagan",
    more: "yana {count} ta",
    yearsExperience: {
      one: "{count} yil tajriba",
      other: "{count} yil tajriba",
    },
    searchVacancies: "Lavozim nomi, boʻlim yoki manzil boʻyicha qidirish",
    searchVacanciesLabel: "Vakansiyalarni qidirish",
    searchCandidates: "Ism, lavozim, manzil yoki koʻnikma boʻyicha qidirish",
    searchCandidatesLabel: "Nomzodlarni qidirish",
    filterByStatus: "Holat boʻyicha filtr",
    filterByDepartment: "Boʻlim boʻyicha filtr",
    filterByVacancy: "Vakansiya boʻyicha filtr",
    filterByProcessing: "Qayta ishlash holati boʻyicha filtr",
    sortCandidates: "Nomzodlarni saralash",
    allProcessingStates: "Barcha qayta ishlash holatlari",
    noDocumentsFilter: "Hujjatsiz",
    noneUploaded: "Yuklanmagan",
    captionVacancies: "Vakansiyalar",
    captionCandidates: "Nomzodlar",
    sortNameAZ: "Ism boʻyicha (A–Z)",
    sortExperienceYears: "Tajriba yillari boʻyicha",
    vacanciesEmptyHint:
      "Kopilot har bir rezyumeda qidiradigan talablarni belgilash uchun vakansiya yarating.",
    vacanciesNoMatchHint:
      "Natijalarni kengaytirish uchun qidiruv yoki filtrlarni oʻzgartiring.",
    candidatesEmptyHint:
      "Jarayonni toʻldirish uchun vakansiya yoki qayta ishlash navbatidan rezyume yuklang.",
    candidatesNoMatchHint:
      "Kengroq qidiruvni sinab koʻring yoki filtrlardan birini olib tashlang.",
    yearsShort: {
      one: "{count} yil",
      other: "{count} yil",
    },
  },

  vacancyForm: {
    roleTitle: "Lavozim",
    roleHint: "Vakansiya roʻyxatda qanday koʻrinadi.",
    title: "Nomi",
    titlePlaceholder: "Senior Backend Engineer",
    department: "Boʻlim",
    departmentPlaceholder: "Muhandislik",
    location: "Manzil",
    locationPlaceholder: "Toshkent, Oʻzbekiston · gibrid",
    employmentType: "Bandlik turi",
    experienceLevel: "Tajriba darajasi",
    descriptionTitle: "Lavozim tavsifi",
    descriptionHint: "E’lon matnini oʻzgarishsiz qoʻyib qoʻysangiz ham boʻladi.",
    description: "Tavsif",
    descriptionPlaceholder:
      "Jamoa nimaga javob beradi, bu odam nima qiladi, kim bilan ishlaydi…",
    requirementsTitle: "Talablar",
    requirementsHint:
      "Har bir qator yuklangan har bir rezyume uchun dalil tekshiruviga aylanadi.",
    addRequirement: "Talab qoʻshish",
    requirementAria: "{index}-talab",
    priorityAria: "{index}-talab ustuvorligi",
    typeAria: "{index}-talab turi",
    removeAria: "{index}-talabni oʻchirish",
    requirementsNote:
      "Qisqa va tekshirsa boʻladigan qilib yozing — dalil jadvalida «Kubernetes» yoki «backendda 3+ yil tajriba» butun bir xatboshidan koʻra yaxshiroq oʻqiladi.",
    saveDraft: "Qoralama sifatida saqlash",
    publish: "Vakansiyani e’lon qilish",
    errTitle: "Lavozim nomini kiriting.",
    errDepartment: "Boʻlimni kiriting.",
    errLocation: "Manzilni kiriting.",
    errDescription: "Talablar konteksti boʻlishi uchun lavozimni tavsiflang.",
    errRequirements:
      "Kamida bitta talab qoʻshing — har bir rezyume shu bilan solishtiriladi.",
    examples: ["NestJS", "Redis", "Kubernetes", "Backendda 3+ yil tajriba"],
    // -- Tuzilgan bo'limlar ---------------------------------------------------
    compensationHint: "Maosh e'lon qilinmasa, bo'sh qoldiring. Tavsifdan hech narsa taxmin qilinmaydi.",
    salaryMin: "Eng kam maosh",
    salaryMax: "Eng ko'p maosh",
    currency: "Valyuta",
    payPeriod: "To'lov davri",
    salaryNegotiable: "Maosh kelishiladi",
    errSalaryRange: "Yuqori chegara quyi chegaradan kam bo'lmasligi kerak.",
    errCurrencyRequired: "Maosh oralig'i uchun valyutani tanlang.",
    locationSectionHint: "Tuzilgan joylashuv. Eski e'lonlarda yuqoridagi erkin matn ko'rinishda qoladi.",
    countryLabel: "Mamlakat",
    regionLabel: "Viloyat / shtat",
    regionPlaceholder: "Toshkent viloyati",
    cityLabel: "Shahar",
    cityPlaceholder: "Seul",
    officeDaysHint: "Haftasiga 0–7 kun ofisda.",
    errOfficeDays: "Ofis kunlari 0 dan 7 gacha bo'lishi kerak.",
    remoteCountriesHint: "Ushbu masofaviy ishni bajarish mumkin bo'lgan mamlakatlar.",
    choose: "Tanlang…",
    visaSectionHint: "Faqat ish beruvchi haqiqatan hal qilgan narsani kiriting.",
    citizenshipHint: "Faqat qonun yoki shartnoma bo'yicha haqiqiy cheklov bo'lganda.",
    errNationalitiesRequired: "Kamida bitta fuqarolik qo'shing yoki cheklovni olib tashlang.",
    experienceSectionHint: "To'liq yillar. Talab bo'lmasa, bo'sh qoldiring.",
    errExperienceRange: "Afzal ko'rilgan tajriba minimaldan kam bo'lolmaydi.",
    educationSectionHint: "Majburiy va afzal ko'rilganni ajratish ularni alohida baholash imkonini beradi.",
    domainExperienceHint: "Sohalar yoki yo'nalishlar, masalan fintex yoki logistika.",
    languagesHint: "Har bir tilga bitta qator. Darajalar CEFR bo'yicha.",
    addLanguage: "Til qo'shish",
    noLanguages: "Til talablari yo'q.",
    languageAria: "Til {index}",
    languageLevelAria: "Til {index} darajasi",
    languagePriorityAria: "Til {index} muhimligi",
    removeLanguageAria: "Til {index} ni o'chirish",
    errDuplicateLanguage: "Har bir til faqat bir marta ko'rsatiladi.",
    errLanguageIncomplete: "Har bir qatorda tilni tanlang yoki bo'sh qatorlarni o'chiring.",
    benefitsHint: "Kompaniya haqiqatan taqdim etadigan narsalar.",
    benefitsOther: "Boshqa imtiyoz",
    timelineHint: "Ariza muddati ish boshlash sanasidan oldin bo'lishi odatiy holdir.",
    startDateHint: "Nomzod qachon ishni boshlaydi.",
    contractDurationHint: "Oylar soni. Doimiy ish uchun bo'sh qoldiring.",
    errOpenings: "Ish o'rinlari soni kamida 1 bo'lishi kerak.",
    errContractDuration: "Shartnoma muddati kamida 1 oy bo'lishi kerak.",
    // -- Tahrirlash rejimi -----------------------------------------------------
    editTitle: "Vakansiyani tahrirlash",
    editHint: "O'zgarishlar ushbu e'longa darhol qo'llanadi.",
    saveChanges: "O'zgarishlarni saqlash",
    saved: "Vakansiya yangilandi.",
    notOwner: "Bu vakansiyani hamkasbingiz yaratgan. Faqat muallif tahrirlay oladi.",
    editRequirementsNote: "Talablar vakansiya sahifasida boshqariladi va bu yerda o'zgarmaydi.",
  },

  candidateForm: {
    candidateTitle: "Nomzod",
    candidateHint: "Faqat ism majburiy — qolganini rezyumedan olsa boʻladi.",
    vacancyTitle: "Vakansiya",
    vacancyHint:
      "Vakansiyaga bogʻlash talab tekshiruvlariga solishtirish uchun asos beradi.",
    applyToVacancy: "Vakansiyaga bogʻlash",
    noVacancy: "Hozircha vakansiyasiz",
    errVacancyRequired: "Bu nomzodni qoʻshish uchun oʻz vakansiyangizni tanlang.",
  },

  /**
   * Re-application vocabulary, shared by every HR surface that shows it.
   *
   * A candidate may apply to one vacancy several times, so both the vacancy
   * applicant list and Candidate Detail speak about attempts — in the same
   * words, from one place, because two copies would drift.
   */
  attempts: {
    count: {
      one: "{count} ta ariza",
      other: "{count} ta ariza",
    },
    label: "{number}-ariza",
    current: "Joriy",
    history: "Oldingi arizalar tarixi",
    viewHistory: "Tarixni koʻrsatish",
    hideHistory: "Tarixni yashirish",
  },

  vacancyDetail: {
    breadcrumbNew: "Yangi",
    jobDescription: "Lavozim tavsifi",
    noDescription: "Bu vakansiyaga tavsif qoʻshilmagan.",
    requirements: "Talablar",
    requirementsSplit: "majburiy: {must} · qoʻshimcha: {nice}",
    noRequirements: "Hali talablar yoʻq",
    noRequirementsHint:
      "Yuklangan har bir rezyume talablar bilan solishtiriladi. Talab boʻlmasa, dalil izlashning ham maʼnosi yoʻq.",
    candidatesAttached: {
      one: "bu vakansiyaga {count} nomzod bogʻlangan",
      other: "bu vakansiyaga {count} nomzod bogʻlangan",
    },
    noCandidates: "Hali ariza yoʻq",
    noCandidatesHint:
      "Bu vakansiyaga ariza topshirgan nomzodlar shu yerda koʻrinadi va har bir rezyume yuqoridagi talablar bilan solishtiriladi.",
    atAGlance: "Qisqacha",
    lastUpdated: "Oxirgi yangilanish",
    readingResumes: "Rezyumelar qanday oʻqiladi",
    readingResumesHint:
      "Nomzodlar ariza topshirayotganda oʻz rezyumesini oʻzlari yuboradi. Yuborilgan har bir rezyume yuqoridagi talablar bilan solishtiriladi — ular uchun hech kim fayl yuklamaydi.",
    created: "{date} da yaratilgan",
    deletedOrWrongLink: "Bu vakansiya oʻchirilgan yoki havola notoʻgʻri boʻlishi mumkin.",
    candidateRemovedOrWrongLink:
      "Bu nomzod oʻchirilgan yoki havola notoʻgʻri boʻlishi mumkin.",
    newVacancyTitle: "Vakansiya yaratish",
    newVacancyHint:
      "Bu yerda qoʻshgan talablaringiz yuklanadigan har bir rezyume uchun tekshiruv mezoni boʻladi.",
    scopedSearchLabel: "Ushbu vakansiya nomzodlari boʻyicha qidiruv",
    scopedSearchPlaceholder:
      "Oddiy tilda soʻrang — masalan: kim prodda Kubernetes bilan ishlagan?",
    scopedSearchNote:
      "Natijalarda har bir moslik olingan parcha, hujjat va sahifa bilan koʻrsatiladi. Model hech kimga baho qoʻymaydi va tartiblamaydi.",
  },

  uploader: {
    dragOrBrowse: "Rezyumelarni shu yerga tashlang yoki fayl tanlang",
    sizeHint: "PDF yoki DOCX, har biri {size} gacha. Bir nechta fayl mumkin.",
    selectFiles: "Fayl tanlash",
    uploading: "Yuklanmoqda",
    skipped: {
      one: "{count} fayl oʻtkazib yuborildi",
      other: "{count} fayl oʻtkazib yuborildi",
    },
    pipeline: "Jarayon",
    indexedOf: "{total} tadan {done} tasi indekslandi",
    failedSuffix: " · {count} tasida xatolik",
    removeFromList: "{name} faylini roʻyxatdan olib tashlash",
    clearList: "Roʻyxatni tozalash",
    hideUploader: "Yuklovchini yashirish",
    uploadResumes: "Rezyume yuklash",
    progressLabel: "{name} bajarilishi",
  },

  employmentType: {
    "Full-time": "Toʻliq bandlik",
    "Part-time": "Qisman bandlik",
    Contract: "Shartnoma",
    Internship: "Amaliyot",
    Temporary: "Vaqtinchalik",
  },

  experienceLevel: {
    Intern: "Amaliyotchi",
    Junior: "Junior",
    "Mid-level": "Middle",
    Senior: "Senior",
    Lead: "Lead",
    Principal: "Principal",
  },

  /* ---------------------------------------------------------------------- */
  /* Vakansiyaning tuzilgan lug'ati                                          */
  /*                                                                        */
  /* Kalitlar — backend enum qiymatlari, faqat yorliq tarjima qilinadi.       */
  /* Saqlanadigan qiymat o'zgarmaydi, shuning uchun tashkilot ma'lumotlari    */
  /* rekruter qaysi tilda ishlaganiga qarab bo'linib ketmaydi.                */
  /* ---------------------------------------------------------------------- */

  payPeriod: {
    HOURLY: "Soatlik",
    MONTHLY: "Oylik",
    YEARLY: "Yillik",
  },

  workMode: {
    ONSITE: "Ofisda",
    HYBRID: "Gibrid",
    REMOTE: "Masofaviy",
  },

  visaSponsorship: {
    YES: "Bor",
    NO: "Yo'q",
    UNKNOWN: "Ko'rsatilmagan",
  },

  citizenshipRequirement: {
    NONE: "Fuqarolik bo'yicha cheklov yo'q",
    SPECIFIC: "Faqat muayyan fuqarolik",
  },

  seniorityLevel: {
    INTERN: "Amaliyotchi",
    JUNIOR: "Junior",
    MID: "Middle",
    SENIOR: "Senior",
    LEAD: "Lead",
    STAFF: "Staff",
    MANAGER: "Menejer",
  },

  languageLevel: {
    A1: "A1 — boshlang'ich",
    A2: "A2 — elementar",
    B1: "B1 — o'rta",
    B2: "B2 — o'rtadan yuqori",
    C1: "C1 — yuqori",
    C2: "C2 — mukammal",
    NATIVE: "Ona tili",
  },

  educationLevel: {
    HIGH_SCHOOL: "O'rta ta'lim",
    ASSOCIATE: "O'rta maxsus ta'lim",
    BACHELOR: "Bakalavr",
    MASTER: "Magistr",
    DOCTORATE: "Doktorlik darajasi",
  },

  hiringUrgency: {
    LOW: "Past",
    NORMAL: "Oddiy",
    HIGH: "Yuqori",
  },

  benefit: {
    HEALTH_INSURANCE: "Tibbiy sug'urta",
    MEAL_ALLOWANCE: "Ovqat uchun to'lov",
    HOUSING_SUPPORT: "Uy-joy yordami",
    RELOCATION_SUPPORT: "Ko'chib o'tishga yordam",
    EDUCATION_BUDGET: "Ta'lim uchun byudjet",
    REMOTE_ALLOWANCE: "Masofaviy ish uchun qo'shimcha to'lov",
    FLEXIBLE_HOURS: "Moslashuvchan ish vaqti",
    STOCK_OPTIONS: "Aksiya optsiyalari",
    BONUS: "Bonus",
    PAID_LEAVE: "Qo'shimcha haq to'lanadigan ta'til",
    OTHER: "Boshqa",
  },

  /**
   * ISO 3166-1 alpha-2 → mamlakat nomi.
   *
   * Intl.DisplayNames o'rniga tarjima qilingan ro'yxat: Node va brauzerdagi
   * ICU jadvallari bir xil emas, server bilan mijoz farqi esa hidratsiya
   * xatosi (lib/i18n/format.ts ga qarang). Ro'yxatda yo'q kod o'zi ko'rinadi.
   */
  country: {
    KR: "Janubiy Koreya",
    UZ: "O'zbekiston",
    RU: "Rossiya",
    KZ: "Qozog'iston",
    US: "AQSh",
    GB: "Buyuk Britaniya",
    DE: "Germaniya",
    FR: "Fransiya",
    NL: "Niderlandiya",
    PL: "Polsha",
    TR: "Turkiya",
    AE: "BAA",
    SG: "Singapur",
    JP: "Yaponiya",
    CN: "Xitoy",
    IN: "Hindiston",
    VN: "Vyetnam",
    PH: "Filippin",
    ID: "Indoneziya",
    MY: "Malayziya",
    TH: "Tailand",
    CA: "Kanada",
    AU: "Avstraliya",
    ES: "Ispaniya",
    IT: "Italiya",
  },

  /**
   * BCP-47 asosiy subtegi → til nomi. Ro'yxat interfeysning to'rt tilidan
   * kengroq: interfeys tili va vakansiya tili — bu boshqa-boshqa savollar.
   */
  jobLanguage: {
    en: "Ingliz tili",
    ko: "Koreys tili",
    ru: "Rus tili",
    uz: "O'zbek tili",
    ja: "Yapon tili",
    zh: "Xitoy tili",
    de: "Nemis tili",
    fr: "Fransuz tili",
    es: "Ispan tili",
    it: "Italyan tili",
    tr: "Turk tili",
    ar: "Arab tili",
    hi: "Hind tili",
    pt: "Portugal tili",
    kk: "Qozoq tili",
    vi: "Vyetnam tili",
    id: "Indonez tili",
    th: "Tay tili",
  },

  /**
   * Normallashtirilgan bandlik turi. Task 1 dagi vakansiya lug'atini takrorlamay,
   * qayta ishlatadi: bir xil so'z vakansiyada ham, nomzod istaklarida ham bir xil
   * ma'noni bildirishi kerak.
   */
  employmentTypeValue: {
    FULL_TIME: "To'liq bandlik",
    PART_TIME: "Qisman bandlik",
    CONTRACT: "Shartnoma",
    INTERNSHIP: "Amaliyot",
    TEMPORARY: "Vaqtinchalik ish",
  },

  jobPreferences: {
    title: "Ish bo'yicha istaklar",
    description:
      "Siz izlayotgan shartlar. Vakansiyalarni topish va tartiblash uchun ishlatiladi va ariza tarkibida ish beruvchiga ko'rsatilmaydi.",
    navLabel: "Istaklar",

    rolesTitle: "Lavozimlar",
    rolesHint:
      "Ko'nikmalar emas, lavozim nomlari. “Kubernetes” emas, “DevOps Engineer”.",
    rolesPlaceholder: "DevOps Engineer",

    locationsTitle: "Joylashuvlar",
    locationsHint:
      "Qayerda ishlamoqchisiz. Avval mamlakatni tanlang, xohlasangiz aniqlashtiring.",
    addLocation: "Joylashuv qo'shish",
    country: "Mamlakat",
    region: "Viloyat / shtat",
    city: "Shahar",
    removeLocation: "{index}-joylashuvni o'chirish",
    noLocations: "Joylashuv qo'shilmagan.",

    workModeTitle: "Ish formati",
    workModeHint:
      "Sizga mos keladiganlarini belgilang. Hech biri belgilanmasa — cheklov yo'q.",

    compensationTitle: "To'lov",
    compensationHint:
      "Siz ko'rib chiqadigan eng kam miqdor. Aytishni istamasangiz, bo'sh qoldiring.",
    salaryMin: "Eng kam maosh",
    currency: "Valyuta",
    payPeriod: "Davr",

    employmentTitle: "Bandlik turi",
    employmentHint: "Siz qabul qila oladigan shartnoma turlari.",

    seniorityTitle: "Daraja",
    seniorityHint:
      "Siz ko'rib chiqilishni istagan darajalar — bu tajribangiz haqidagi da'vo emas.",

    additionalTitle: "Qo'shimcha istaklar",
    relocationTitle: "Ko'chib o'tish",
    relocationHint: "Mos ish uchun ko'chib o'tishga tayyormisiz?",
    relocationLabel: "Ko'chib o'tishga tayyorman",

    industriesTitle: "Sohalar",
    industriesHint: "Siz ishlashni istagan yo'nalishlar.",
    industriesPlaceholder: "Fintex",

    benefitsTitle: "Imtiyozlar",
    benefitsHint: "Maoshdan tashqari siz uchun muhim narsalar.",

    exclusionsTitle: "Istisnolar",
    exclusionsHint:
      "Ko'rishni istamaydigan narsalaringiz. Faqat shu yerda kiritilgani hisobga olinadi — o'tkazib yuborilgan vakansiyalardan hech narsa o'rganilmaydi.",
    excludedCompanies: "Istisno qilinadigan kompaniyalar",
    excludedCompaniesPlaceholder: "Company X",
    excludedJobTitles: "Istisno qilinadigan lavozimlar",
    excludedJobTitlesPlaceholder: "PHP Developer",
    excludedLocations: "Istisno qilinadigan joylashuvlar",

    notStated: "Ko'rsatilmagan",
    noPreference: "Cheklov yo'q",
    unknown: "Ko'rsatilmagan",
    save: "Istaklarni saqlash",
    saved: "Istaklar saqlandi.",
    clearAll: "Barcha istaklarni o'chirish",
    clearAllConfirm:
      "Siz ko'rsatgan barcha istaklar o'chiriladi. Profil, hujjatlar va arizalarga ta'sir qilmaydi.",
    cleared: "Istaklar o'chirildi.",
    empty:
      "Siz hali ish bo'yicha istaklarni kiritmagansiz. Rezyumedan hech narsa taxmin qilinmaydi — faqat shu yerda kiritganingiz hisobga olinadi.",
    lastUpdated: "Yangilangan {date}",

    errSalaryAmount: "Noldan katta butun son kiriting yoki bo'sh qoldiring.",
    errSalaryCurrency: "Miqdor uchun valyutani tanlang.",
    errSalaryPeriod: "Miqdor uchun davrni tanlang.",
    errSalaryAmountMissing: "Miqdorni kiriting yoki valyuta va davrni tozalang.",
    errLocationCountry: "Har bir joylashuv uchun mamlakatni tanlang.",
    saveFailed: "Istaklarni saqlab bo'lmadi. Qayta urinib ko'ring.",
      salaryMax: "Maksimum (ixtiyoriy)",
    salaryMaxHint: "Siz mo‘ljallagan oraliqning yuqori chegarasi. Undan yuqori to‘lovli ishlar ham ko‘rsatiladi — bu chegara emas, mo‘ljal.",
    errSalaryRange: "Maksimum minimumdan kam bo‘lmasligi kerak.",
},

  jobProfile: {
    compensation: "To'lov",
    locationWork: "Joylashuv va ish formati",
    workAuthorization: "Ishlash huquqi",
    experience: "Tajriba va daraja",
    education: "Ta'lim va sertifikatlar",
    languages: "Tillar",
    benefits: "Imtiyozlar",
    timeline: "Ishga olish muddatlari",

    notSpecified: "Ko'rsatilmagan",
    negotiable: "Kelishuv asosida",
    required: "Majburiy",
    preferred: "Afzal",
    yes: "Ha",
    no: "Yo'q",

    salary: "Maosh",
    salaryRange: "{min} – {max}",
    salaryFrom: "{min} dan",
    salaryUpTo: "{max} gacha",
    perPeriod: "{amount} / {period}",

    location: "Joylashuv",
    workModeLabel: "Ish formati",
    officeDays: "Ofis kunlari",
    officeDaysValue: "haftasiga {count} kun",
    remoteCountries: "Quyidagi mamlakatlardan qabul qilinadi",

    foreignApplicants: "Chet ellik nomzodlar",
    visaSponsorshipLabel: "Viza homiyligi",
    existingWorkAuth: "Mavjud ishlash huquqi",
    existingWorkAuthRequired: "Talab qilinadi",
    existingWorkAuthNotRequired: "Talab qilinmaydi",
    eligibleVisas: "Mos viza turlari",
    citizenship: "Fuqarolik",
    eligibleNationalities: "Mos fuqaroliklar",
    visaDisclaimer:
      "Ish beruvchi tomonidan ko'rsatilgan. Bu yuridik maslahat emas va huquqni kafolatlamaydi.",

    seniority: "Daraja",
    minExperience: "Minimal tajriba",
    preferredExperience: "Afzal ko'rilgan tajriba",
    yearsValue: "{count} yil",

    requiredEducation: "Majburiy ta'lim",
    preferredEducation: "Afzal ko'rilgan ta'lim",
    requiredCertifications: "Majburiy sertifikatlar",
    preferredCertifications: "Afzal ko'rilgan sertifikatlar",
    domainExperience: "Soha tajribasi",

    deadline: "Ariza muddati",
    expectedStart: "Ishni boshlash sanasi",
    openings: "Ish o'rinlari soni",
    urgency: "Shoshilinchlik",
    contractDuration: "Shartnoma muddati",
    monthsValue: "{count} oy",
  },


  workspaces: {
    title: "Ish maydonini tanlang",
    description:
      "Bir marta kirasiz. Har bir ish maydonining oʻz maʼlumotlari va oʻz roli bor.",
    organizations: "Tashkilotlar",
    noOrganizations: "Siz hali birorta tashkilotga aʼzo emassiz.",
    noOrganizationsHint:
      "Tashkilot egasi yoki HR administratori sizni qoʻsha oladi. Ungacha ochiladigan tashkilot ish maydoni yoʻq.",
    current: "Joriy",
    open: "Ochish",
    switching: "Ish maydoni almashtirilmoqda…",
    switchFailed: "Ish maydonini almashtirib boʻlmadi.",
    switchedTo: "Endi «{name}» ichidasiz",
    membershipRevoked: "Bu ish maydoniga ruxsatingiz olib tashlandi",
    membershipRevokedHint:
      "Davom etish uchun boshqa ish maydonini tanlang. Bu xato boʻlsa, oʻsha tashkilot administratoriga murojaat qiling.",
  },

  /**
   * Professional havolalar — dalil tizimining nomzod tomonidagi yarmi.
   *
   * Xatolik matnlari operator uchun emas, odam uchun yozilgan: uning
   * havolasiga nima boʻlgani va nima qila olishi. HTTP holati, host nomi yoki
   * ichki sabab hech qachon koʻrsatilmaydi.
   */
  candidateLinks: {
    title: "Professional havolalar",
    hint: "{limit} tagacha ochiq havola — portfolio, repozitoriy, loyiha sahifasi. Ular fayllaringiz kabi tahlil qilinadi.",
    empty: "Hozircha havola yoʻq.",
    add: "Havola qoʻshish",
    remove: "Oʻchirish",
    retry: "Qayta urinish",
    refresh: "Tahlilni yangilash",
    urlLabel: "Havola",
    urlPlaceholder: "https://your-portfolio.com",
    labelLabel: "Nom (ixtiyoriy)",
    labelPlaceholder: "Mening portfoliom",
    slots: "{limit} havoladan {count} tasi ishlatilgan",
    analysedOn: "{date} sanasida tahlil qilingan",
    limitReached:
      "Havola oʻrinlari toʻlgan. Yangisini qoʻshish uchun bittasini oʻchiring. Fayllar alohida hisoblanadi.",
    privacyNote:
      "Saqlangan havolalar faqat profilingizda koʻrinadi. Ariza berganingizda oʻqilgan kontent nusxasi oʻsha ariza bilan yuboriladi. Havolani tahrirlash yuborilgan arizani oʻzgartirmaydi, lekin oʻchirsangiz u oʻsha arizalardan ham oʻchadi.",
    addFailed: "Bu havolani qoʻshib boʻlmadi.",
    removeFailed: "Bu havolani oʻchirib boʻlmadi.",
    retryFailed: "Bu havolani qayta tahlil qilib boʻlmadi.",
    confirmDeleteTitle: "Bu professional havola oʻchirilsinmi?",
    confirmDeleteQuestion: "“{name}” profilingizdan oʻchiriladi.",
    confirmDeleteConsequence:
      "Bu dalil siz yuborgan arizalardan va ish beruvchilar koʻradigan AI tahlilidan ham oʻchiriladi. Arizalarning oʻzi saqlanib qoladi.",
    errorCodes: {
      LINK_LIMIT_REACHED:
        "Siz 3 tagacha professional havola saqlashingiz mumkin. Yangisini qoʻshish uchun bittasini oʻchiring.",
      LINK_DUPLICATE: "Bu havola allaqachon qoʻshilgan.",
      LINK_INVALID_URL:
        "Bu ochiq veb-manzilga oʻxshamaydi. Tekshirib, qayta urinib koʻring.",
      LINK_NOT_RETRYABLE:
        "Bu havolani qayta tahlil qilib boʻlmaydi. Manzilni tahrirlang yoki oʻchiring.",
      LINK_BUSY: "Bu havola allaqachon tahlil qilinmoqda.",
    },
    failureCodes: {
      INVALID_URL: "Bu manzilni oʻqib boʻlmadi. Tekshirib, qayta urinib koʻring.",
      UNSUPPORTED_PROTOCOL:
        "Faqat http:// yoki https:// bilan boshlanadigan ochiq veb-manzillardan foydalanish mumkin.",
      PRIVATE_NETWORK_URL:
        "Bu manzil ochiq internetdan mavjud emas, shuning uchun bu yerda ishlatib boʻlmaydi.",
      FETCH_TIMEOUT: "Sayt juda uzoq javob berdi. Qayta urinib koʻrishingiz mumkin.",
      TOO_MANY_REDIRECTS:
        "Bu manzil doimiy yoʻnaltirdi. Sahifaga toʻgʻridan-toʻgʻri havolani sinab koʻring.",
      CONTENT_TOO_LARGE:
        "Bu sahifa tahlil uchun juda katta. Aniq bir sahifaga havola bering.",
      UNSUPPORTED_CONTENT_TYPE:
        "Bu havola biz oʻqiy olmaydigan fayl turiga ishora qiladi. Fayllarni fayllar boʻlimiga yuklang.",
      ACCESS_DENIED:
        "Bu sahifa ochiq emas — kirish talab qilinishi yoki u endi mavjud boʻlmasligi mumkin.",
      NO_MEANINGFUL_CONTENT:
        "Bu sahifada oʻqiladigan matn topilmadi. Agar kontent JavaScript orqali koʻrsatilsa, matni bor sahifaga havola bering.",
      RENDER_FAILED: "Bu sahifani ochib boʻlmadi. Qayta urinib koʻrishingiz mumkin.",
      UPSTREAM_ERROR: "Sayt xatolik qaytardi. Qayta urinib koʻrishingiz mumkin.",
      INDEXING_FAILED:
        "Sahifa oʻqildi, lekin tahlilga tayyorlab boʻlmadi. Qayta urinib koʻrishingiz mumkin.",
    },
  },

  candidateProfile: {
    title: "Mening profilim",
    description: "Ariza berganingizda ishga qabul jamoasi nimani koʻradi.",
    createTitle: "Ish izlovchi profilini yarating",
    createHint:
      "Profil siz ishlaydigan tashkilotlardan mustaqil. U sizniki va mazmunini siz belgilaysiz.",
    create: "Profil yaratish",
    notCreated: "Siz hali ish izlovchi profilini yaratmagansiz",
    basics: "Asosiy maʼlumot",
    basicsHint: "Profilingiz sarlavhasi.",
    headline: "Qisqa taʼrif",
    headlinePlaceholder: "Backend muhandis",
    location: "Manzil",
    phone: "Telefon",
    summary: "Oʻzingiz haqingizda",
    summaryPlaceholder: "Qanday ish qilganingiz haqida bir necha jumla.",
    skills: "Koʻnikmalar",
    skillsHint: "Har birini qoʻshish uchun Enter bosing.",
    languages: "Tillar",
    experience: "Tajriba",
    experienceHint: "Eng yangisi birinchi. Sanalar erkin matn — «2021», «2021-03».",
    addExperience: "Ish joyi qoʻshish",
    removeExperience: "{index}-ish joyini oʻchirish",
    jobTitle: "Lavozim",
    company: "Kompaniya",
    startDate: "Dan",
    endDate: "Gacha",
    roleDescription: "Nima qilgansiz",
    education: "Taʼlim",
    addEducation: "Taʼlim qoʻshish",
    removeEducation: "{index}-taʼlimni oʻchirish",
    institution: "Oʻquv muassasasi",
    degree: "Daraja",
    field: "Yoʻnalish",
    startYear: "Boshlangan yil",
    endYear: "Tugagan yil",
    visibility: "Profil koʻrinishi",
    visibilityHint:
      "«Yopiq» — yuborgan maʼlumotingizni faqat siz ariza bergan tashkilotlar koʻradi.",
    visibilityPrivate: "Yopiq",
    visibilityPublic: "Ochiq",
    resume: "Rezyume",
    documents: "Rezyume hujjatlari",
    resumeHint:
      "PDF yoki DOCX, {size} gacha. Eng soʻnggi yuklangan fayl keyingi arizalar uchun rezyume boʻladi.",
    noResume: "Hali rezyume yuklanmagan",
    uploadResume: "Rezyume yuklash",
    addDocument: "Hujjat qoʻshish",
    replaceResume: "Rezyumeni almashtirish",
    uploading: "Yuklanmoqda",
    downloadResume: "Rezyumeni ochish",
    deleteDocument: "Oʻchirish",
    primaryResume: "Asosiy",
    documentSlots: "{limit} hujjatdan {count} tasi ishlatilgan",
    documentLimitReached:
      "3 hujjatlik cheklovga yetdingiz. Boshqa hujjat yuklash uchun bittasini oʻchiring.",
    uploadedOn: "{date} yuklangan",
    personalResumeNote:
      "Rezyumeingiz faqat sizda qoladi. Ariza berganingizda nusxasi faqat oʻsha tashkilotga yuboriladi.",
    errTitleRequired: "Ish joyi uchun lavozim kerak.",
    errInstitutionRequired: "Taʼlim yozuvi uchun oʻquv muassasasi kerak.",
    saveFailed: "Profilni saqlab boʻlmadi.",
    createFailed: "Profilni yaratib boʻlmadi.",
    resumeUploadFailed: "Faylni yuklab boʻlmadi.",
    documentDeleteFailed: "Hujjatni oʻchirib boʻlmadi.",
    retryDocument: "Qayta urinish",
    documentRetryFailed: "Hujjatni qayta ishlashni takrorlab boʻlmadi.",
    confirmDeleteTitle: "Bu hujjat oʻchirilsinmi?",
    confirmDeleteQuestion: "“{name}” butunlay oʻchiriladi.",
    confirmDeleteConsequence:
      "Bu dalil siz yuborgan arizalardan va ish beruvchilar koʻradigan AI tahlilidan ham oʻchiriladi. Arizalarning oʻzi saqlanib qoladi.",
  },

  jobs: {
    title: "Ish topish",
    description: "Profilingizdagi rezyume bilan ariza bera oladigan ochiq vakansiyalar.",
    searchPlaceholder: "Lavozim nomi va tavsif boʻyicha qidirish",
    searchLabel: "Vakansiyalarni qidirish",
    locationPlaceholder: "Manzil",
    locationLabel: "Manzil boʻyicha filtr",
    submit: "Qidirish",
    clear: "Filtrlarni tozalash",
    resultCount: {
      one: "{count} ochiq vakansiya",
      other: "{count} ochiq vakansiya",
    },
    empty: "Hozircha ochiq vakansiya yoʻq",
    emptyHint: "Tashkilotlar e’lon qilgach, yangi vakansiyalar shu yerda koʻrinadi.",
    noMatches: "Bu soʻrovga mos vakansiya topilmadi",
    noMatchesHint: "Kamroq soʻz bilan urinib koʻring yoki manzil filtrini olib tashlang.",
    postedOn: "{date} e’lon qilingan",
    applicantCount: {
      one: "{count} nomzod",
      other: "{count} nomzod",
    } as Plural,
    rankNote:
      "Ish formati, bandlik turi, daraja va maosh eng mos ishlarni oldinga chiqaradi — hech narsa yashirilmaydi.",
    locationFilterNote: "Joylashuvni tanlash natijalarni toraytiradi.",
    currencyNeeded: "Maoshlarni davlatlar bo‘ylab solishtirish uchun valyutani tanlang.",
    save: "Saqlash",
    saved: "Saqlangan",
    unsave: "Saqlanganlardan olib tashlash",
    aboutRole: "Lavozim haqida",
    noDescription: "Bu vakansiyada tavsif yoʻq.",
    requirements: "Ular nimani qidirmoqda",
    mustHave: "Majburiy",
    niceToHave: "Qoʻshimcha ustunlik",
    apply: "Ariza berish",
    applyAgain: "Qayta ariza topshirish",
    previousAttemptRejected:
      "Bu lavozimga oldingi arizangiz rad etilgan. Qayta ariza topshirishingiz mumkin — avvalgi urinish tarixingizda saqlanadi.",
    applying: "Yuborilmoqda",
    applied: "Ariza berilgan",
    appliedHint: "Siz bu vakansiyaga ariza bergansiz. «Mening arizalarim»da kuzating.",
    applySucceeded: "Ariza yuborildi",
    applySucceededHint:
      "Rezyume nusxasi «{organization}» ga yuborildi. Ular oʻqib qaror qiladi — hech narsa avtomatik baholanmaydi.",
    viewApplications: "Arizalarimni koʻrish",
    notFound: "Bu vakansiya endi ochiq emas",
    notFoundHint: "U yopilgan yoki toʻldirilgan boʻlishi mumkin. Boshqa vakansiyalarni koʻring.",
    backToJobs: "Vakansiyalarga qaytish",
    needsProfile: "Avval profil yarating",
    needsProfileHint:
      "Ariza bilan profil va rezyume yuboriladi, shuning uchun ikkalasi ham kerak.",
    goToProfile: "Profilimga oʻtish",
    needsResume: "Avval rezyume yuklang",
    needsResumeHint: "Arizaga rezyume nusxasi ilova qilinadi, shuning uchun u boʻlishi kerak.",
    alreadyApplied: "Siz allaqachon ariza bergansiz",
    alreadyAppliedHint:
      "Har bir vakansiyaga bir marta. Arizani qaytarib olsangiz ham qayta bera olmaysiz — jamoa mavjud arizangiz bilan davom etishi mumkin.",
    jobUnavailable: "Bu vakansiya endi ariza qabul qilmaydi",
      filtersTitle: "Filtrlar",
    moreFilters: "Ko‘proq filtr",
    fewerFilters: "Kamroq filtr",
    countryLabel: "Mamlakat",
    workModeLabel: "Ish shakli",
    employmentLabel: "Bandlik turi",
    seniorityLabel: "Tajriba darajasi",
    salaryLabel: "Eng kam maosh",
    salaryAmountPlaceholder: "Summa",
    anyOption: "Har qanday",
    applyFilters: "Qidirish",
    usingPreferences: "Saqlangan xohishlaringiz ishlatilmoqda. Bu yerdagi o‘zgarishlar faqat shu qidiruvga taalluqli.",
    editPreferences: "Xohishlarni tahrirlash",
    salaryUnknownKept: "Maosh ko‘rsatilmagan — baribir ko‘rsatildi",
    salaryNotComparableKept: "Maoshni solishtirib bo‘lmadi — baribir ko‘rsatildi",
},

  applications: {
    title: "Mening arizalarim",
    description: "Siz ariza bergan barcha vakansiyalar va ularning bosqichi.",
    empty: "Hali ariza yoʻq",
    emptyHint: "Ariza bergan vakansiyalaringiz joriy bosqichi bilan shu yerda koʻrinadi.",
    appliedOn: "{date} da ariza berilgan",
    updatedOn: "{date} da yangilangan",
    withdraw: "Qaytarib olish",
    withdrawing: "Qaytarilmoqda",
    withdrawn: "Ariza qaytarib olindi",
    withdrawFailed: "Arizani qaytarib olib boʻlmadi.",
    cannotWithdraw: "Bu arizani endi qaytarib olib boʻlmaydi",
    cannotWithdrawHint:
      "Uning bosqichi yakuniy. Endi holatni faqat ishga qabul jamoasi oʻzgartira oladi.",
    stageNote:
      "Bosqichlarni ishga qabul jamoasi belgilaydi. Sizning yagona amalingiz — arizani qaytarib olish.",
  },

  chat: {
    title: "Suhbat chatlari",
    messages: "Xabarlar",
    hrDescription:
      "Suhbatga taklif qilingan nomzodlar bilan vakansiyaga bogʻlangan suhbatlar.",
    candidateDescription:
      "Ishga qabul jamoasi sizni suhbatga taklif qilgan vakansiyalar bo‘yicha chatlar.",
    conversations: "Suhbatlar",
    conversationsHint: "Bu yerda faqat chat ochilgan suhbat takliflari koʻrinadi.",
    noConversations: "Suhbatlar yoʻq",
    noConversationsHint:
      "Suhbat taklifi platformadagi chatni ochgandan keyin u shu yerda chiqadi.",
    selectConversation: "Suhbatni tanlang",
    selectConversationHint: "Roʻyxatdan suhbat chatini tanlang.",
    loadingMessages: "Xabarlar yuklanmoqda",
    emptyConversation: "Hali xabar yoʻq",
    emptyConversationHint: "Suhbatni kelishish uchun qisqa xabar yozing.",
    inviteToInterview: "Suhbatga taklif qilish",
    reject: "Rad etish",
    openChat: "Chatni ochish",
    send: "Yuborish",
    typeMessage: "Xabar yozing",
    you: "Siz",
    viewVacancy: "Vakansiyani koʻrish",
    viewJob: "Vakansiyani koʻrish",
    chatUnavailable: "Chat mavjud emas",
    candidateRejectedNotice:
      "Nomzod rad etildi va suhbat chati oʻchirildi.",
    vacancyClosedNotice: "Vakansiya yopildi va suhbat chati oʻchirildi.",
    chatDeleted: "Bu suhbat chati oʻchirildi.",
    connected: "Ulangan",
    connecting: "Ulanmoqda",
    reconnecting: "Qayta ulanmoqda",
    loadFailed: "Bu suhbatni yuklab boʻlmadi.",
    sendFailed: "Xabarni yuborib boʻlmadi.",
    closeVacancy: "Vakansiyani yopish",
    closeVacancyFailed: "Vakansiyani yopib boʻlmadi.",
    closeVacancyQuestion: "Bu vakansiyani yopmoqchimisiz?",
    areYouSure: "Ishonchingiz komilmi?",
    allChatsDeleted:
      "Bu vakansiyadagi barcha suhbat chatlari butunlay oʻchiriladi.",
    yes: "Ha",
    no: "Yoʻq",
  },

  savedJobs: {
    title: "Saqlangan vakansiyalar",
    description: "Keyinroq qaytmoqchi boʻlgan vakansiyalaringiz.",
    empty: "Hali hech narsa saqlanmagan",
    emptyHint: "Vakansiyani saqlang — u shu yerda sizni kutadi.",
    savedOn: "{date} saqlangan",
    remove: "Olib tashlash",
    closed: "Endi ochiq emas",
    closedHint: "Bu vakansiya saqlaganingizdan keyin yopilgan, ariza berib boʻlmaydi.",
    viewJob: "Vakansiyani koʻrish",
  },

  sessions: {
    title: "Kirilgan qurilmalar",
    description:
      "Sessiyasi faol boʻlgan barcha brauzer va qurilmalar. Chiqish darhol kuchga kiradi.",
    thisDevice: "Ushbu qurilma",
    unknownDevice: "Nomaʼlum qurilma",
    created: "{date} da kirilgan",
    lastUsed: "Oxirgi faollik {date}",
    expires: "{date} da tugaydi",
    signOut: "Chiqish",
    signOutTitle: "{device} qurilmasidan chiqish",
    signingOut: "Chiqilmoqda",
    signOutEverywhere: "Hamma joydan chiqish",
    signOutEverywhereHint:
      "Joriysi ham kiradigan barcha sessiyalarni tugatadi. Qurilma yoʻqolganda ishlating.",
    revokeFailed: "Bu sessiyadan chiqib boʻlmadi.",
    empty: "Boshqa qurilmalarda faol sessiya yoʻq.",
    unavailable: "Sessiyalarni yuklab boʻlmadi",
    unavailableHint: "Birozdan soʻng urinib koʻring — joriy sessiyaga taʼsir qilmaydi.",
  },

  authErrors: {
    AUTH_INVALID_REFRESH_TOKEN: "Sessiyangiz endi yaroqsiz. Qaytadan kiring.",
    AUTH_REFRESH_TOKEN_EXPIRED: "Sessiyangiz muddati tugadi. Qaytadan kiring.",
    AUTH_REFRESH_TOKEN_REUSED:
      "Hisob maʼlumotlari ikki marta ishlatilgani uchun xavfsizlik yuzasidan sessiya tugatildi. Qaytadan kiring.",
    AUTH_SESSION_REVOKED: "Bu sessiyadan chiqilgan. Qaytadan kiring.",
    AUTH_SESSION_NOT_FOUND: "Bunday sessiya endi mavjud emas. Qaytadan kiring.",
    generic: "Sessiya tugadi. Qaytadan kiring.",
  },

  jobMatch: {
    title: "AI ish tanlash",
    description:
      "Profilingiz va rezyumengizga mos ochiq vakansiyalar — har bir moslik ortidagi dalillar bilan.",
    introTitle: "Menga qaysi ishlar mos?",
    introHint:
      "Tanlash profilingiz va rezyumengizni ochiq vakansiyalar bilan solishtiradi va har bir talab nimaga asoslanganini koʻrsatadi. Taxminan yigirma soniya davom etadi.",
    run: "Mosliklarni topish",
    refresh: "Yangilash",
    clearResults: "Natijalarni tozalash",
    matchCount: {
      one: "{count} ta mos vakansiya",
      other: "{count} ta mos vakansiya",
    } as Plural,
    loadingStages: [
      "Profil va rezyume tahlil qilinmoqda…",
      "Mos ochiq vakansiyalar qidirilmoqda…",
      "Ish talablari solishtirilmoqda…",
      "Dalilga asoslangan izohlar tayyorlanmoqda…",
    ],
    loadMore: "Yana koʻrsatish",
    loadingMore: "Yuklanmoqda…",
    showingCount: "{total} tadan {shown} tasi koʻrsatilmoqda",
    refreshing: "Yangilanmoqda…",
    refreshingHint:
      "Mosliklar fonda yangilanmoqda. Joriy natijalar ekranda qoladi.",
    refreshFailed:
      "Mosliklarni yangilab boʻlmadi. Oldingi natijalar ekranda qoladi.",
    strength: {
      STRONG: "Kuchli moslik",
      PARTIAL: "Qisman moslik",
      WEAK: "Kuchsiz moslik",
    },
    coverageNote:
      "Moslik belgilari vakansiya talablarining qanchasi hujjatlaringiz bilan tasdiqlanganini bildiradi. Bu sizga berilgan baho ham, ariza topshirish tavsiyasi ham emas.",
    explanationPending:
      "Bu moslik uchun izoh yozilmoqda. Quyidagi dalillar allaqachon toʻliq.",
    explanationUnavailable:
      "AI izohi vaqtincha mavjud emas. Quyidagi moslik dalillari toʻliq holda taqdim etiladi.",
    requirementSummary: "Talablar xulosasi",
    supported: "Mos keladigan jihatlarim",
    missing: "Yetishmayotgan jihatlarim",
    unclear: "Noaniq jihatlar",
    noneInGroup: "Bu guruhda qayd etilgan band yoʻq.",
    required: "majburiy",
    viewEvidence: "Dalillarni koʻrish",
    viewJob: "Vakansiyani ochish",
    needProfileTitle: "Avval profil yarating",
    needProfileHint:
      "Ish tanlash profilingiz va rezyumengiz asosida ishlaydi. Boshlash uchun nomzod profilini yarating.",
    notReadyTitle: "AI ish mosligidan foydalanish uchun dalil qoʻshing",
    notReadyHint:
      "Moslik fayllaringiz va professional havolalaringizni oʻqiydi. Rezyume yuklang yoki havola qoʻshing — profilning oʻzi dalil emas.",
    completeProfile: "Profilni toʻldirish",
    goToProfile: "Profilimga oʻtish",
    staleNotice:
      "Dalillaringiz oʻzgardi. Joriy profilingizni tahlil qilish uchun mosliklarni yangilang.",
    resumeImprovesWithLinks:
      "Aniqroq moslik uchun rezyume qoʻshing. Professional havolalaringiz allaqachon tahlil qilinmoqda.",
    resumeImproves:
      "Rezyume tanlash sifatini oshiradi: talablar haqiqiy hujjatlaringiz bilan solishtiriladi.",
    uploadResume: "Rezyume yuklash",
    noMatches: "Hozircha mos vakansiya yoʻq",
    noMatchesHint:
      "Ochiq vakansiyalarning birortasi profilingizga mos kelmadi. Yangi vakansiyalar ochilganda yana tekshirib koʻring.",
    unavailable: "Tanlash vaqtincha ishlamayapti",
    unavailableHint:
      "Tanlash xizmatiga hozir ulanib boʻlmadi. Hech narsa hisoblanmadi — birozdan soʻng qayta urinib koʻring.",
      scoreLabel: "Moslik bahosi",
    scoreValue: "{score} / 100",
    band: {
      STRONG: "Yuqori moslik",
      GOOD: "Yaxshi moslik",
      PARTIAL: "Qisman moslik",
      LOW: "Past moslik",
    },
    topReasons: "Asosiy sabablar",
    whyMatches: "Nega bu ish mos keladi",
    whyNotHigher: "Nega baho yuqoriroq emas",
    capabilitySection: "Malaka",
    preferencesSection: "Xohishlaringizga moslik",
    salarySection: "Maosh",
    approxSalary: "≈ {amount}",
    convertedNote: "Kutgan maoshingiz bilan solishtirish uchun ish beruvchi ko‘rsatgan summadan hisoblab chiqarilgan.",
    fxUpdated: "Valyuta kurslari {ago} yangilangan",
    fxUnavailable: "Valyuta kursi mavjud emas",
    noPreferences: "Xohishlaringizni ko‘rsating — har bir ish ular bilan qanchalik mos kelishini ko‘rasiz.",
    excludedNote: {
      one: "Istisnolaringiz tufayli {count} ta ish yashirildi",
      other: "Istisnolaringiz tufayli {count} ta ish yashirildi",
    } as Plural,
    capabilityStrong: "Hujjatlaringiz bu ishning {count} ta talabini tasdiqlaydi",
    capabilityNone: "Bu ish ko‘rsatgan talablardan hech biri hujjatlaringizda topilmadi",
    capabilityMissing: "{count} ta talab hujjatlaringizda topilmadi",
    capabilityUnclear: "{count} ta talabni odam ko‘rib chiqishi kerak",
    skillsMatched: "{skills} bo‘yicha dalil bor",
    matchReason: {
      ROLE_EXACT: "Siz istagan lavozimga mos keladi",
      ROLE_RELATED: "Siz istagan lavozimga juda yaqin",
      ROLE_FAMILY_MATCH: "Siz izlayotgan turdagi ish",
      ROLE_FAMILY_ADJACENT: "Siz izlayotgan ishga yaqin soha",
      ROLE_MISMATCH: "Siz istagan lavozimlardan boshqasi",
      LOCATION_EXACT: "Siz afzal ko‘rgan shaharda",
      LOCATION_REGION_MATCH: "Siz afzal ko‘rgan hududda",
      LOCATION_COUNTRY_MATCH: "Siz afzal ko‘rgan mamlakatda",
      LOCATION_REMOTE_ELIGIBLE: "Masofaviy va sizning mamlakatingizdan mumkin",
      LOCATION_MISMATCH: "Joylashuv siz istagandan farq qiladi",
      LOCATION_UNKNOWN: "Ish beruvchi joylashuvni ko‘rsatmagan",
      WORK_MODE_MATCH: "Ish shakli xohishingizga mos",
      WORK_MODE_MISMATCH: "Ish shakli xohishingizdan farq qiladi",
      WORK_MODE_UNKNOWN: "Ish beruvchi ish shaklini ko‘rsatmagan",
      SALARY_WITHIN_DESIRED_RANGE: "Maosh siz istagan oraliqda",
      SALARY_ABOVE_DESIRED_RANGE: "Maosh siz istagan oraliqdan yuqori",
      SALARY_PARTIAL_OVERLAP: "Maosh siz istagan oraliq bilan qisman kesishadi",
      SALARY_MEETS_MINIMUM: "Maosh eng kam talabingizga javob beradi",
      SALARY_BELOW_MINIMUM: "Maosh siz istagan eng kam summadan past",
      SALARY_UNKNOWN: "Ish beruvchi maoshni ko‘rsatmagan",
      SALARY_NOT_COMPARABLE: "Maoshni solishtirib bo‘lmadi",
      EMPLOYMENT_MATCH: "Bandlik turi xohishingizga mos",
      EMPLOYMENT_MISMATCH: "Bandlik turi xohishingizdan farq qiladi",
      EMPLOYMENT_UNKNOWN: "Ish beruvchi bandlik turini ko‘rsatmagan",
      SENIORITY_MATCH: "Tajriba darajasi xohishingizga mos",
      SENIORITY_ADJACENT: "Tajriba darajasi xohishingizga yaqin",
      SENIORITY_MISMATCH: "Tajriba darajasi xohishingizdan farq qiladi",
      SENIORITY_UNKNOWN: "Ish beruvchi tajriba darajasini ko‘rsatmagan",
      INDUSTRY_MATCH: "Siz afzal ko‘rgan sohada",
      INDUSTRY_MISMATCH: "Siz ko‘rsatgan sohalardan emas",
      INDUSTRY_UNKNOWN: "Ish beruvchi sohani ko‘rsatmagan",
      BENEFITS_MATCH: "Siz ko‘rsatgan imtiyozlar mavjud",
      BENEFITS_PARTIAL: "Siz ko‘rsatgan imtiyozlarning bir qismi mavjud",
      BENEFITS_MISMATCH: "Siz ko‘rsatgan imtiyozlar yo‘q",
      BENEFITS_UNKNOWN: "Ish beruvchi imtiyozlarni ko‘rsatmagan",
    },
},
  vacancyScope: {
    selectorLabel: "Mening vakansiyam",
    myVacancies: "Mening vakansiyalarim",
    choosePlaceholder: "Vakansiyani tanlang",
    allVacancies: "Barcha vakansiyalarim",
    noneTitle: "Hozircha vakansiya yoʻq",
    noneHint: "Avval vakansiya yarating — nomzodlar, dalillar va suhbatlar oʻsha vakansiya ichida boʻladi.",
    invalidSelection: "Bu sizning vakansiyangiz emas",
    selectFirstTitle: "Oʻz vakansiyangizni tanlang",
    selectFirstHint: "Ichida ishlash uchun yuqoridan vakansiyani tanlang.",
    notOwned: "Bu vakansiyani tashkilotingizning boshqa xodimi yaratgan. Siz faqat oʻzingiz yaratgan vakansiyalar ichida ishlay olasiz.",
    notFound: "Bu vakansiya mavjud emas.",
    candidateNotInVacancy: "Bu nomzod tanlangan vakansiyaga biriktirilmagan.",
    noCandidatesTitle: "Hali ariza yoʻq",
    noCandidatesHint: "Bu vakansiyaga ariza topshirgan nomzodlar shu yerda koʻrinadi.",
    scopedToVacancy: "Kim uchun: {title}",
    select: "Tanlash",
    selected: "Tanlangan",
    ownedByOther: "Hamkasb yaratgan",
    deleteSelected: "Tanlanganlarni oʻchirish",
    deleteConfirmTitle: "Tanlangan vakansiya oʻchirilsinmi?",
    deleteConfirmTitlePlural: "Tanlangan vakansiyalar oʻchirilsinmi?",
    deleteConfirmHint: "Ular bilan birga nomzodlarning arizalari, dalillari va suhbatlari ham oʻchiriladi.",
    yes: "Ha",
    no: "Yoʻq",
    deleting: "Oʻchirilmoqda",
    deleteFailed: "Hech narsa oʻchirilmadi. Tanlovda siz oʻchira olmaydigan vakansiya bor.",
    deletedCount: {
      one: "{count} ta vakansiya oʻchirildi",
      other: "{count} ta vakansiya oʻchirildi",
    } as Plural,
    selectedCount: {
      one: "{count} ta tanlandi",
      other: "{count} ta tanlandi",
    } as Plural,
    selectAll: "Barchasini tanlash",
    clearSelection: "Tanlovni bekor qilish",
    chatUnavailable: "Suhbat mavjud emas",
    chatUnavailableHint: "U oʻchirilgan boʻlishi yoki siz yaratmagan vakansiyaga tegishli boʻlishi mumkin.",
    accountRequired: "Bu nomzodda platforma hisobi yoʻq, shuning uchun suhbat mavjud emas.",
  },
  status: {
    vacancy: {
      DRAFT: "Qoralama",
      OPEN: "Ochiq",
      CLOSED: "Yopiq",
      ARCHIVED: "Arxivlangan",
    },
    document: {
      UPLOADED: "Yuklandi",
      QUEUED: "Navbatda",
      PARSING: "Tahlil qilinmoqda",
      CHUNKING: "Boʻlaklanmoqda",
      EMBEDDING: "Vektorlanmoqda",
      INDEXING: "Indekslanmoqda",
      COMPLETED: "Yakunlandi",
      FAILED: "Xatolik",
    },
    /** Havolaning holati. Odamni emas, oʻqish jarayonini tavsiflaydi. */
    link: {
      PENDING: "Kutilmoqda",
      FETCHING: "Sahifa oʻqilmoqda",
      PROCESSING: "Tahlil qilinmoqda",
      COMPLETED: "Tahlil qilindi",
      FAILED: "Oʻqib boʻlmadi",
    },
    pipeline: {
      UPLOADED: "Yuklandi",
      PARSING: "Tahlil",
      CHUNKING: "Boʻlaklash",
      EMBEDDING: "Vektorlash",
      INDEXING: "Indekslandi",
      COMPLETED: "Yakunlandi",
    },
    job: {
      PENDING: "Kutilmoqda",
      QUEUED: "Navbatda",
      RUNNING: "Bajarilmoqda",
      COMPLETED: "Yakunlandi",
      FAILED: "Xatolik",
    },
    documentType: {
      RESUME: "Rezyume",
      PORTFOLIO: "Portfolio",
      JOB_DESCRIPTION: "Lavozim tavsifi",
      HR_DOCUMENT: "HR hujjati",
    },
    requirementType: {
      SKILL: "Koʻnikma",
      EXPERIENCE: "Tajriba",
      EDUCATION: "Taʼlim",
      LANGUAGE: "Til",
      OTHER: "Boshqa",
    },
    application: {
      NEW: "Yangi",
      REVIEWING: "Koʻrib chiqilmoqda",
      INTERVIEW: "Intervyu",
      OFFER: "Taklif",
      HIRED: "Ishga olindi",
      REJECTED: "Rad etildi",
      WITHDRAWN: "Qaytarib olindi",
    },
    applicationSource: {
      DIRECT: "Toʻgʻridan-toʻgʻri",
      EMAIL: "Email",
      LINKEDIN: "LinkedIn",
      INDEED: "Indeed",
      SARAMIN: "Saramin",
      JOBKOREA: "JobKorea",
      WANTED: "Wanted",
      JUMPIT: "Jumpit",
      REFERRAL: "Tavsiya",
      MANUAL_UPLOAD: "Qoʻlda yuklangan",
    },
    role: {
      OWNER: "Egasi",
      HR_ADMIN: "HR administrator",
      RECRUITER: "Rekruter",
      INTERVIEWER: "Intervyu oluvchi",
    },
    evidence: {
      FOUND: "Dalil topildi",
      NOT_FOUND: "Dalil topilmadi",
      NEEDS_REVIEW: "Inson tekshiruvi zarur",
      NOT_RUN: "Hali xaritalanmagan",
    },
    evidenceShort: {
      FOUND: "Topildi",
      NOT_FOUND: "Topilmadi",
      NEEDS_REVIEW: "Tekshirish",
      NOT_RUN: "Ishga tushirilmagan",
    },
    answer: {
      GROUNDED: "Dalilga asoslangan",
      INSUFFICIENT_EVIDENCE: "Dalil yetarli emas",
      NEEDS_HUMAN_REVIEW: "Inson tekshiruvi zarur",
    },
    questionKind: {
      evidence_probe: "Dalilni aniqlashtirish",
      missing_requirement_probe: "Yetishmayotgan talab",
    },
    requirementPriority: {
      required: "Majburiy",
      optional: "Qoʻshimcha ustunlik",
    },
    stream: {
      connecting: "Ulanmoqda",
      live: "Jonli",
      reconnecting: "Qayta ulanmoqda",
      offline: "Kuzatilmayapti",
    },
    candidateStage: {
      NEW: "Yuborildi",
      REVIEWING: "Koʻrib chiqilmoqda",
      INTERVIEW: "Intervyu",
      OFFER: "Taklif",
      HIRED: "Ishga olindi",
      REJECTED: "Tanlanmadi",
      WITHDRAWN: "Qaytarib olindi",
    },
    candidateStageHint: {
      NEW: "Arizangiz qabul qilindi.",
      REVIEWING: "Ishga qabul jamoasidan kimdir arizangizni oʻqimoqda.",
      INTERVIEW: "Siz intervyu bosqichiga yetdingiz.",
      OFFER: "Taklif tayyorlanmoqda yoki allaqachon yuborilgan.",
      HIRED: "Siz taklifni qabul qildingiz.",
      REJECTED: "Jamoa davom etmaslikka qaror qildi.",
      WITHDRAWN: "Siz bu arizani qaytarib oldingiz.",
    },
    integrationAvailability: {
      planned: "Ulanmagan",
      requires_partner_approval: "Hamkor roziligi kerak",
    },
  },

  externalApplications: {
    tab: "Mening tashqi arizalarim",
    title: "Mening tashqi arizalarim",
    description:
      "Ish beruvchilarning saytlarida topshirgan arizalaringiz. Bu ro‘yxatni o‘zingiz yuritasiz: HR Copilot bunday arizalarni qabul qilmaydi va ularning taqdirini kuzata olmaydi.",
    managedByYou: "Bu ro‘yxatni o‘zingiz yuritasiz.",
    notInternal:
      "HR Copilot ichida topshirgan arizalaringiz «Mening arizalarim» bo‘limida.",
    goToInternal: "Mening arizalarim",
    markApplied: "Ariza topshirdim deb belgilash",
    markAppliedHint:
      "Ish beruvchi saytini ochish hech narsani yozib qo‘ymaydi. Haqiqatan ariza topshirganingizdan keyin shu yerda belgilang.",
    marking: "Saqlanmoqda…",
    markFailed: "Yozib bo‘lmadi. Qayta urinib ko‘ring.",
    statusLabel: "Ariza holati",
    updateStatus: "Holatni o‘zgartirish",
    updateFailed: "Holatni o‘zgartirib bo‘lmadi. Qayta urinib ko‘ring.",
    removeTracking: "Yozuvni o‘chirish",
    removeTrackingHint:
      "Faqat sizning yozuvingiz o‘chadi. Ish beruvchidagi ariza qaytarib olinmaydi.",
    removeFailed: "Yozuvni o‘chirib bo‘lmadi. Qayta urinib ko‘ring.",
    appliedOn: "{date} da topshirilgan",
    filterAll: "Barchasi",
    clearStatusFilter: "Barchasini ko‘rsatish",
    emptyForStatus: "Bu holatdagi yozuv yo‘q.",
    emptyForStatusHint:
      "Boshqa tashqi arizalaringizni ko‘rish uchun holat filtrini o‘zgartiring.",
    listingGoneTitle: "E’lon endi mavjud emas",
    listingGoneHint:
      "E’lon katalogdan chiqib ketgan. Sizning yozuvingiz saqlanib qoldi.",
    listingStatusLabel: "E’lonning joriy holati",
    listingActive: "Hali e’lon qilingan",
    note: "Eslatmalar",
    notePlaceholder: "masalan: rekruter bog‘landi · 4-sentyabr texnik suhbat",
    saveNote: "Eslatmani saqlash",
    noteSaved: "Eslatma saqlandi",
    empty: "Hozircha kuzatilayotgan tashqi ariza yo‘q.",
    emptyHint:
      "Ish beruvchi saytida ariza topshirgach, shu yerda belgilang — ro‘yxatda paydo bo‘ladi.",
    errorTitle: "Ro‘yxatni yuklab bo‘lmadi",
    errorHint: "Hozir mavjud emas. Qayta urinib ko‘ring.",
    viewJob: "Vakansiyani ko‘rish",
    openOriginal: "Ish beruvchi saytida ochish",
    status: {
      APPLIED: "Ariza topshirilgan",
      INTERVIEW: "Suhbat",
      OFFER: "Taklif",
      REJECTED: "Rad etilgan",
      WITHDRAWN: "Qaytarib olingan",
    },
  },

  externalJobs: {
    title: "Tashqi ish o‘rinlari",
    description:
      "Boshqa ish e’lonlari saytlari va kompaniyalarning karyera sahifalarida e’lon qilingan ish o‘rinlari. Ariza ish beruvchining o‘z saytida topshiriladi — HR Copilot bunday arizalarni qabul qilmaydi.",
    searchTab: "Qidiruv",
    whyMatchTitle: "Nega bu ish sizga mos?",
    whyMatchInvite: "Bu e’lon nega shu o‘rinda turganini qisqacha tushuntirib beramiz.",
    whyMatchGenerate: "Tushuntirish olish",
    whyMatchStrengths: "Kuchli tomonlar",
    whyMatchGaps: "Mumkin bo‘lgan kamchiliklar",
    tabsLabel: "E’lon qayerda joylangan",

    searchLabel: "Tashqi ish o‘rinlarini qidirish",
    searchPlaceholder: "Lavozim, ko‘nikma yoki kompaniya",
    submit: "Qidirish",
    filters: "Filtrlar",
    filtersWithCount: "Filtrlar ({count})",
    filtersTitle: "Filtrlar",
    applyFilters: "Natijalarni ko‘rsatish",
    reset: "Filtrlarni tozalash",
    resetHint:
      "Faqat shu yerda tanlanganini tozalaydi. Saqlangan istaklaringiz o‘zgarmaydi.",
    close: "Yopish",
    moreFilters: "Ko‘proq filtr",
    fewerFilters: "Kamroq filtr",

    countryLabel: "Mamlakat",
    filterTag: "Filtr",
    preferenceTag: "Istak",
    countryHint:
      "Faqat tanlangan mamlakatlarda ochiq bo‘lgan ish o‘rinlarini ko‘rsatadi.",
    preferenceHint:
      "Mos keladiganlarni yuqoriga chiqaradi. Hech narsani yashirmaydi.",
    workModeLabel: "Ish formati",
    employmentLabel: "Bandlik turi",
    seniorityLabel: "Tajriba darajasi",
    salaryLabel: "Eng kam maosh",
    salaryAmountPlaceholder: "Miqdor",
    currencyLabel: "Valyuta",
    payPeriodLabel: "Davr",
    anyOption: "Har qanday",
    currencyNeeded:
      "Mamlakatlar bo‘ylab maoshni solishtirish uchun valyuta va davrni tanlang.",

    usingPreferences:
      "Natijalar saqlangan ish istaklaringiz asosida tartiblangan.",
    editPreferences: "Istaklarni tahrirlash",

    resultCount: {
      one: "{count} mos ish o‘rni",
      other: "{count} ta mos ish o‘rni",
    } as Plural,
    truncatedNote:
      "Eng mos natijalar ko‘rsatilmoqda. Bu filtrlarga mos yana ish o‘rinlari bor.",
    degradedNotice:
      "Ma’noga asoslangan moslashtirish vaqtincha ishlamayapti. Faqat matn bo‘yicha natijalar ko‘rsatilmoqda.",

    searching: "Tashqi ish o‘rinlari qidirilmoqda…",
    searchingHint:
      "Uzoq tanaffusdan keyingi birinchi qidiruv bir necha soniya olishi mumkin.",

    empty: "So‘rovingizga mos tashqi ish o‘rni topilmadi",
    emptyHint: "Quyidagilarni sinab ko‘ring:",
    emptyFewerWords: "Gap emas, lavozim nomi bilan qidiring",
    emptyClearCountry: "Mamlakat filtrini olib tashlang",
    emptyClearAll: "Filtrlarni tozalang",
    browseTitle: "Tashqi ish o‘rinlarini ko‘rish",
    browseHint:
      "Lavozim nomini kiriting yoki filtrlardan mamlakatni tanlang. Saqlangan istaklaringiz tartibga allaqachon ta’sir qilmoqda.",

    errorTitle: "Tashqi ish o‘rinlarini qidirib bo‘lmadi",
    errorHint: "Hech narsa hisoblanmadi. Bir ozdan so‘ng qayta urinib ko‘ring.",
    retry: "Qayta urinish",
    needsAccountTitle: "Avval profil yarating",
    needsAccountHint:
      "Tashqi qidiruv natijalarni tartiblash uchun nomzod profilingizdan foydalanadi. Boshlash uchun profil yarating.",
    goToProfile: "Profilimga o‘tish",

    scoreLabel: "Moslik",
    scoreValue: "{score} / 100",
    scoreNote:
      "Bu ish o‘rni so‘rovingiz va istaklaringizga qanchalik mos kelishini bildiradi. Ishga qabul qilinish ehtimoli emas.",
    band: {
      STRONG: "Yuqori moslik",
      GOOD: "Yaxshi moslik",
      PARTIAL: "Qisman moslik",
      LOW: "Past moslik",
    },
    whyThis: "Nega bu natija",

    locationUnknown: "Ish joyi ko‘rsatilmagan",
    alsoOpenIn: "Shuningdek ochiq",
    moreLocations: {
      one: "+{count} ta joy",
      other: "+{count} ta joy",
    } as Plural,
    remoteStated: "Masofaviy · quyidagilardan mumkin: {countries}",
    remoteUnstated: "Masofaviy · mamlakatlar ko‘rsatilmagan",
    remoteUnstatedHint:
      "Ish beruvchi bu masofaviy ish qaysi mamlakatlardan ochiqligini aytmagan.",

    salaryUnknown: "Maosh ko‘rsatilmagan",
    salaryNote: "Ish beruvchi e’lon qilgan holda.",

    staleNotice: "E’lonni qayta tekshirish kerak bo‘lishi mumkin",
    staleHint:
      "So‘nggi paytda hech bir manba bu e’lonni qayta ko‘rsatmadi. U hali ochiq bo‘lishi mumkin — asl e’lonni tekshiring.",
    save: "Vakansiyani saqlash",
    savedState: "Saqlangan",
    unsave: "Saqlanganlardan olib tashlash",
    saveFailed: "Vakansiyani saqlab bo‘lmadi. Qayta urinib ko‘ring.",
    unsaveFailed: "Vakansiyani olib tashlab bo‘lmadi. Qayta urinib ko‘ring.",
    savedTab: "Saqlanganlar",
    savedTitle: "Saqlangan tashqi vakansiyalar",
    savedDescription:
      "Tashqi vakansiyalardan saqlab qo‘yganlaringiz. Ariza ish beruvchining saytida topshiriladi.",
    savedEmpty: "Hozircha saqlangan tashqi vakansiya yo‘q.",
    savedEmptyHint:
      "Tashqi vakansiyalarni ko‘rib chiqayotganda saqlang — ular shu yerda ko‘rinadi.",
    savedPageEmpty: "Bu sahifada hech narsa yo‘q.",
    savedPageEmptyHint: "Qolganlari oldingi sahifalarda.",
    savedFirstPage: "Birinchi sahifaga o‘tish",
    savedErrorTitle: "Saqlangan vakansiyalarni yuklab bo‘lmadi",
    savedErrorHint: "Ro‘yxat hozir mavjud emas. Qayta urinib ko‘ring.",
    savedOn: "{date} da saqlangan",
    browseExternal: "Tashqi vakansiyalarni ko‘rish",
    closedNotice: "Tanlov yopilgan",
    expiredNotice: "Ariza muddati tugagan",
    unavailableNotice: "E’lonni ochib bo‘lmaydi",
    unexpectedStatus: "Bu e’lon endi ochiq bo‘lmasligi mumkin",

    sourceLine: "Manba: {source}",
    applyViaLine: "Ariza orqali: {source}",
    sourceCountLine: "{count} ta manbada ko‘rsatilgan",
    sourceUnknown: "Tashqi manba",
    source: {
      GREENHOUSE: "Greenhouse",
      LEVER: "Lever",
      ASHBY: "Ashby",
      NINEHIRE: "Ninehire",
      COMPANY_CAREERS: "Kompaniya karyera sahifasi",
    },

    apply: "Asl saytda ariza topshirish",
    applyHint:
      "Ish beruvchi sayti yangi oynada ochiladi. HR Copilot bu arizani olmaydi va kuzata olmaydi.",
    externalLink: "yangi oynada ochiladi",
    viewDetails: "Batafsil",
    detailsTitle: "Ish o‘rni tafsilotlari",
    aboutRole: "Bu ish haqida",
    requirements: "Ular nimani qidirmoqda",
    noDescription:
      "Bu yerda tavsif yo‘q. O‘qish uchun asl e’lonni oching.",
    skills: "Ko‘nikmalar",
    languages: "Tillar",
    benefits: "Imtiyozlar",
    industries: "Sohalar",
    loadingDetail: "Ish o‘rni yuklanmoqda…",
    detailError: "Bu ish o‘rnini yuklab bo‘lmadi.",
    detailGone: "Bu ish o‘rni endi e’lon qilinmagan.",
    companySite: "Kompaniya sayti",


    sortLabel: "Saralash",
    sortRelevance: "Mosligi bo‘yicha",
    sortNewest: "Avval yangilari",
    sortNewestNote:
      "Ish beruvchi e’lonni joylagan sana bo‘yicha tartiblangan. Sanasi ko‘rsatilmagan e’lonlar oxirida.",

    postedToday: "Bugun joylangan",
    postedYesterday: "Kecha joylangan",
    postedDaysAgo: {
      one: "{count} kun oldin joylangan",
      other: "{count} kun oldin joylangan",
    } as Plural,
    postedOn: "{date} da joylangan",
    reason: {
      TEXT_STRONG_MATCH: "Qidiruvingizga juda mos",
      TEXT_TITLE_MATCH: "Qidiruvingizga mos",
      TEXT_PARTIAL_MATCH: "Qidiruvingizga qisman mos",
      TEXT_SEMANTIC_MATCH: "Qidirganingizga ma’no jihatdan yaqin",
      STALE_LISTING: "E’lonni qayta tekshirish kerak bo‘lishi mumkin",
    },
  },

  aiJobSearch: {
    tabsLabel: "AI ish qidiruvi",
    internalTab: "Ichki AI ish o‘rinlari",
    externalTab: "Tashqi AI ish o‘rinlari",
    lockedTabLabel: "{tab} — {plan} tarifidan boshlab mavjud",
    internal: {
      sourceName: "HR Copilot ish o‘rinlari",
      applyMeaning: "HR Copilot ichida ariza topshiriladi",
    },
    external: {
      sourceName: "Tashqi ish o‘rinlari",
      applyMeaning: "Ish beruvchining saytida ariza topshiriladi",
    },
  },

  plans: {
    title: "Tariflar",
    description:
      "Har bir tarif ish qidiruvingiz uchun nimalarni o‘z ichiga olishi. Narxlar oyiga ko‘rsatilgan.",
    names: { FREE: "Free", PRO: "Pro", MAX: "Max" },
    availableOn: "{plan} tarifidan boshlab mavjud.",
    upgradeTo: "{plan} tarifiga o‘tish",
    viewPlans: "Tariflarni ko‘rish",
    priceMonthly: "oyiga ${amount}",
    currentPlan: "Joriy tarif",
    currentPlanIs: "Siz {plan} tarifidasiz.",
    noCheckoutNote:
      "To‘lov hozircha mavjud emas, shuning uchun bu sahifadan xarid qilib bo‘lmaydi. Sahifa har bir tarif nimani o‘z ichiga olishini ko‘rsatadi.",
    locked: {
      INTERNAL_AI_SEARCH: {
        title: "Ichki AI ish qidiruvi",
        description:
          "HR Copilot’da e’lon qilingan ish o‘rinlarini profilingizga qarab tartiblaydi va har biri nega mos kelganini tushuntiradi. Ariza shu yerda topshiriladi. Oddiy ish qidiruvi barcha tariflarda ochiq qoladi.",
      },
      EXTERNAL_AI_SEARCH: {
        title: "Tashqi AI ish qidiruvi",
        description:
          "HR Copilot’dan tashqarida e’lon qilingan ish o‘rinlarini qidiradi, qaytib ko‘rmoqchi bo‘lganlaringizni saqlaydi va qayerga ariza topshirganingizni o‘zingiz yozib borasiz. Ariza ish beruvchining saytida topshiriladi.",
      },
    },
    cards: {
      FREE: {
        tagline: "HR Copilot’da e’lon qilingan ishlarni qidirish va ariza topshirish.",
        features: [
          "Oddiy ish qidiruvi",
          "HR Copilot ishlariga ariza topshirish",
          "Saqlangan ishlar va ariza tarixi",
        ],
      },
      PRO: {
        tagline: "HR Copilot ishlari uchun AI tartiblashni qo‘shadi.",
        features: [
          "Free’dagi hamma narsa",
          "Ichki AI ish qidiruvi",
          "Har bir ish uchun moslik sabablari",
        ],
      },
      MAX: {
        tagline: "HR Copilot’dan tashqaridagi ishlarni qo‘shadi.",
        features: [
          "Pro’dagi hamma narsa",
          "Tashqi AI ish qidiruvi",
          "«Nega bu ish mos» — AI tushuntirishi",
          "Saqlangan tashqi ishlar",
          "Tashqi arizalaringiz hisobi",
        ],
      },
    },
  },

  premiumAi: {
    disclaimer:
      "Matnni AI sizning profilingiz va ushbu e’lon asosida yozgan. U moslik ballini tushuntiradi, uni o‘zgartirmaydi va xato bo‘lishi mumkin.",
    generating: "Tushuntirish yozilmoqda…",
    tryAgain: "Qayta urinish",
    unavailable:
      "Hozir tushuntirish yozib bo‘lmadi. Sahifadagi qolgan ma’lumotlarga ta’sir qilmaydi.",
    failed: "Tushuntirishni yuklab bo‘lmadi.",
    jobGone: "Bu ish o‘rni endi e’lon qilinmagan, tushuntiradigan narsa yo‘q.",
    strengthLabel: "kuchli tomon",
    gapLabel: "mumkin bo‘lgan kamchilik",
  },

};

export default uz;
