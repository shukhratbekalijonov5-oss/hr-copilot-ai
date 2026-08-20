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
    dashboard: "Boshqaruv paneli",
    vacancies: "Vakansiyalar",
    candidates: "Nomzodlar",
    aiSearch: "AI qidiruv",
    compare: "Taqqoslash",
    processing: "Qayta ishlash",
    settings: "Sozlamalar",
    findJobs: "Ish topish",
    aiJobMatch: "AI ish tanlash",
    myApplications: "Mening arizalarim",
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
    quickAddCandidate: "Nomzod qoʻshish",
    quickAddCandidateHint: "Avval nomzodni yarating, soʻng rezyumesini yuklang.",
    quickUploadResumes: "Rezyume yuklash",
    quickUploadResumesHint:
      "PDF yoki DOCX yuklang va indekslanishini kuzating.",
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
    noCandidates: "Hali nomzod yoʻq",
    noCandidatesHint:
      "Nomzod qoʻshing va rezyumesini yuklab jarayonni boshlang.",
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
    add: "Nomzod qoʻshish",
    addTitle: "Nomzod qoʻshish",
    addDescription:
      "Avval nomzodni yarating, soʻng rezyumesini yuklang — u indekslanadi.",
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
    added: "Qoʻshilgan",
    documents: "Hujjatlar",
    documentsUploaded: {
      one: "{count} fayl yuklandi",
      other: "{count} fayl yuklandi",
    },
    uploadPrompt:
      "Rezyume yuklang — u tahlil qilinib, indekslanadi va ushbu vakansiya talablari bilan solishtiriladi.",
    applications: "Arizalar",
    applicationsHint: "Bosqich oʻzgarishi uni bajargan xodim bilan qayd etiladi.",
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
    emailLocked: "Kirish manzilini oʻzgartirishni API hali qoʻllab-quvvatlamaydi.",
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
  },

  candidateForm: {
    candidateTitle: "Nomzod",
    candidateHint: "Faqat ism majburiy — qolganini rezyumedan olsa boʻladi.",
    vacancyTitle: "Vakansiya",
    vacancyHint:
      "Vakansiyaga bogʻlash talab tekshiruvlariga solishtirish uchun asos beradi.",
    applyToVacancy: "Vakansiyaga bogʻlash",
    noVacancy: "Hozircha vakansiyasiz",
    errFullName: "Toʻliq ismni kiriting.",
    errFullNameShort: "Nomzodning toʻliq ismini kiriting.",
    errEmail: "Toʻgʻri email manzilini kiriting.",
    errYears: "0 dan 80 gacha son kiriting.",
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
    noCandidates: "Hali nomzod yoʻq",
    noCandidatesHint:
      "Nomzod qoʻshing va rezyumesini yuklang — har biri yuqoridagi talablar bilan solishtiriladi.",
    atAGlance: "Qisqacha",
    lastUpdated: "Oxirgi yangilanish",
    readingResumes: "Rezyumelar qanday oʻqiladi",
    readingResumesHint:
      "Hujjatlar vakansiyaga emas, nomzodga bogʻlanadi. Avval odamni qoʻshing, soʻng uning sahifasidan rezyumesini yuklang — aynan shu faylni ushbu talablar bilan bogʻlaydi.",
    created: "{date} da yaratilgan",
    deletedOrWrongLink: "Bu vakansiya oʻchirilgan yoki havola notoʻgʻri boʻlishi mumkin.",
    candidateRemovedOrWrongLink:
      "Bu nomzod oʻchirilgan yoki havola notoʻgʻri boʻlishi mumkin.",
    newVacancyTitle: "Vakansiya yaratish",
    newVacancyHint:
      "Bu yerda qoʻshgan talablaringiz yuklanadigan har bir rezyume uchun tekshiruv mezoni boʻladi.",
    newCandidateHint:
      "Avval odamni yarating, keyingi ekranda rezyumesini yuklaysiz.",
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
    resumeHint: "PDF yoki DOCX, {size} gacha. Almashtirish yuborilgan arizalarni oʻzgartirmaydi.",
    noResume: "Hali rezyume yuklanmagan",
    uploadResume: "Rezyume yuklash",
    replaceResume: "Rezyumeni almashtirish",
    uploading: "Yuklanmoqda",
    downloadResume: "Rezyumeni ochish",
    uploadedOn: "{date} yuklangan",
    personalResumeNote:
      "Rezyumeingiz faqat sizda qoladi. Ariza berganingizda nusxasi faqat oʻsha tashkilotga yuboriladi.",
    errTitleRequired: "Ish joyi uchun lavozim kerak.",
    errInstitutionRequired: "Taʼlim yozuvi uchun oʻquv muassasasi kerak.",
    saveFailed: "Profilni saqlab boʻlmadi.",
    createFailed: "Profilni yaratib boʻlmadi.",
    resumeUploadFailed: "Faylni yuklab boʻlmadi.",
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
    save: "Saqlash",
    saved: "Saqlangan",
    unsave: "Saqlanganlardan olib tashlash",
    aboutRole: "Lavozim haqida",
    noDescription: "Bu vakansiyada tavsif yoʻq.",
    requirements: "Ular nimani qidirmoqda",
    mustHave: "Majburiy",
    niceToHave: "Qoʻshimcha ustunlik",
    apply: "Ariza berish",
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
  },

  applications: {
    title: "Mening arizalarim",
    description: "Siz ariza bergan barcha vakansiyalar va ularning bosqichi.",
    empty: "Hali ariza yoʻq",
    emptyHint: "Ariza bergan vakansiyalaringiz joriy bosqichi bilan shu yerda koʻrinadi.",
    appliedOn: "{date} da ariza berilgan",
    updatedOn: "{date} da yangilangan",
    submittedResume: "{name} yuborilgan",
    withdraw: "Qaytarib olish",
    withdrawing: "Qaytarilmoqda",
    withdrawn: "Ariza qaytarib olindi",
    withdrawFailed: "Arizani qaytarib olib boʻlmadi.",
    cannotWithdraw: "Bu arizani endi qaytarib olib boʻlmaydi",
    cannotWithdrawHint:
      "Uning bosqichi yakuniy. Endi holatni faqat ishga qabul jamoasi oʻzgartira oladi.",
    stageNote:
      "Bosqichlarni ishga qabul jamoasi belgilaydi. Sizning yagona amalingiz — arizani qaytarib olish.",
    source: "Manba",
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
    notReadyTitle: "Tanlash uchun maʼlumot qoʻshing",
    notReadyHint:
      "Profilingizga koʻnikma, tajriba yoki qisqacha maʼlumot qoʻshing — yoki rezyume yuklang, shunda tanlash uchun dalil boʻladi.",
    completeProfile: "Profilni toʻldirish",
    resumeImproves:
      "Rezyume tanlash sifatini oshiradi: talablar haqiqiy hujjatlaringiz bilan solishtiriladi.",
    uploadResume: "Rezyume yuklash",
    noMatches: "Hozircha mos vakansiya yoʻq",
    noMatchesHint:
      "Ochiq vakansiyalarning birortasi profilingizga mos kelmadi. Yangi vakansiyalar ochilganda yana tekshirib koʻring.",
    unavailable: "Tanlash vaqtincha ishlamayapti",
    unavailableHint:
      "Tanlash xizmatiga hozir ulanib boʻlmadi. Hech narsa hisoblanmadi — birozdan soʻng qayta urinib koʻring.",
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
};

export default uz;
