/**
 * Development seed. Wipes and repopulates the database.
 * NEVER run against production — guarded below.
 *
 *   npm run db:seed
 */
import { PrismaClient, Role, AccountStatus, PublicationType, DegreeLevel, CourseLevel, ProjectType, ProjectStatus, GuidanceDegree, GuidanceStatus } from '@prisma/client';

const db = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed in production.');
}

/**
 * Domain for seeded fixture accounts.
 *
 * Derived from ALLOWED_EMAIL_DOMAINS so seeded users can actually log in once the
 * Sprint 2 domain restriction exists — the two must agree or every seeded account
 * is locked out.
 *
 * Defaults to a `.invalid` host (RFC 2606), which can never resolve and can never
 * receive mail. That matters: these fixtures previously used a real-looking domain
 * nobody here owns, so a seed run pointed at real SMTP instead of Mailpit would
 * have emailed strangers.
 */
const EMAIL_DOMAIN =
  process.env.SEED_EMAIL_DOMAIN?.trim() ||
  process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0]?.trim() ||
  'faculty.example.invalid';

const DEPARTMENTS = [
  { name: 'Computer Science and Engineering', code: 'CSE', slug: 'computer-science-engineering' },
  { name: 'Electronics and Communication Engineering', code: 'ECE', slug: 'electronics-communication-engineering' },
  { name: 'Mechanical Engineering', code: 'ME', slug: 'mechanical-engineering' },
  { name: 'Mathematics and Computing', code: 'MC', slug: 'mathematics-computing' },
];

// 10 faculty, deliberately varied: different publication counts, some with
// no awards, no projects, or no guidance records (empty-state coverage),
// and one with a very long name / very long publication title so layout
// breakage under real-world-length content shows up in Sprint 3, not at launch.
const FACULTY: Array<{
  email: string;
  fullName: string;
  slug: string;
  designation: string;
  dept: string;
  about: string;
  interests: string[];
  orcid: string | null;
  educationCount: number;
  publicationCount: number;
  positionCount: number;
  awardCount: number;
  courseCount: number;
  hasProject: boolean;
  guidanceCount: number;
  hasMembership: boolean;
  longTitle?: boolean;
}> = [
  {
    email: `anita.sharma@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Anita Sharma',
    slug: 'anita-sharma',
    designation: 'Professor',
    dept: 'CSE',
    about: 'Working at the intersection of distributed systems and machine learning infrastructure, with a focus on fault-tolerant training pipelines.',
    interests: ['Distributed Systems', 'Machine Learning Systems', 'Fault Tolerance'],
    orcid: '0000-0002-1825-0097',
    educationCount: 3, publicationCount: 3, positionCount: 2, awardCount: 2, courseCount: 2, hasProject: true, guidanceCount: 2, hasMembership: true,
  },
  {
    email: `rajesh.verma@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Rajesh Verma',
    slug: 'rajesh-verma',
    designation: 'Associate Professor',
    dept: 'ECE',
    about: 'Research on low-power VLSI design and embedded signal processing for biomedical instrumentation.',
    interests: ['VLSI Design', 'Embedded Systems', 'Biomedical Signal Processing'],
    orcid: null,
    educationCount: 3, publicationCount: 3, positionCount: 2, awardCount: 2, courseCount: 2, hasProject: true, guidanceCount: 2, hasMembership: true,
  },
  {
    email: `priya.nair@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Priya Nair',
    slug: 'priya-nair',
    designation: 'Assistant Professor',
    dept: 'MC',
    about: 'Numerical analysis of partial differential equations, with applications to computational fluid dynamics.',
    interests: ['Numerical Analysis', 'PDEs', 'Computational Fluid Dynamics'],
    orcid: null,
    educationCount: 3, publicationCount: 3, positionCount: 2, awardCount: 2, courseCount: 2, hasProject: true, guidanceCount: 2, hasMembership: true,
  },
  {
    email: `sanjay.gupta@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Sanjay Gupta',
    slug: 'sanjay-gupta',
    designation: 'Professor',
    dept: 'ME',
    about: 'Thermal-fluid systems and heat exchanger design for industrial process optimisation.',
    interests: ['Heat Transfer', 'Thermal Systems', 'Process Optimisation'],
    orcid: '0000-0001-2345-6789',
    educationCount: 2, publicationCount: 4, positionCount: 2, awardCount: 1, courseCount: 3, hasProject: true, guidanceCount: 1, hasMembership: true,
  },
  {
    email: `deepa.krishnan@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Deepa Krishnan',
    slug: 'deepa-krishnan',
    designation: 'Assistant Professor',
    dept: 'CSE',
    about: 'Human-computer interaction and accessibility in low-resource educational settings.',
    interests: ['HCI', 'Accessibility', 'EdTech'],
    orcid: null,
    // Deliberately no awards — exercises the empty state on the public profile and dashboard.
    educationCount: 2, publicationCount: 2, positionCount: 1, awardCount: 0, courseCount: 2, hasProject: false, guidanceCount: 0, hasMembership: false,
  },
  {
    email: `mohammed.iqbal@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Mohammed Iqbal',
    slug: 'mohammed-iqbal',
    designation: 'Assistant Professor',
    dept: 'ECE',
    about: 'Early-career researcher in RF and microwave circuit design.',
    interests: ['RF Circuits', 'Microwave Engineering'],
    orcid: null,
    // Just one publication — a freshly hired assistant professor, low completeness.
    educationCount: 2, publicationCount: 1, positionCount: 1, awardCount: 0, courseCount: 1, hasProject: false, guidanceCount: 0, hasMembership: false,
  },
  {
    email: `kavita.reddy@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Kavita Reddy',
    slug: 'kavita-reddy',
    designation: 'Professor',
    dept: 'MC',
    about: 'Two decades of work in cryptographic protocol design and formal verification, with a large publication record spanning theory and applied systems.',
    interests: ['Cryptography', 'Formal Verification', 'Protocol Design', 'Theoretical Computer Science'],
    orcid: '0000-0003-4567-890X',
    // Heavy publication list — tests pagination/scroll in the publications section.
    educationCount: 3, publicationCount: 6, positionCount: 3, awardCount: 3, courseCount: 3, hasProject: true, guidanceCount: 4, hasMembership: true,
  },
  {
    email: `arvind.subramaniam@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Arvind Chandrasekaran Venkataraman Subramaniam',
    slug: 'arvind-chandrasekaran-venkataraman-subramaniam',
    designation: 'Professor and Head of Department',
    dept: 'ME',
    about: 'Robotics and mechatronics, with an emphasis on compliant actuation for prosthetic devices.',
    interests: ['Robotics', 'Mechatronics', 'Prosthetics'],
    orcid: '0000-0004-5678-9012',
    educationCount: 3, publicationCount: 2, positionCount: 2, awardCount: 2, courseCount: 2, hasProject: true, guidanceCount: 2, hasMembership: true,
    // Stress-tests title wrapping in cards, hero, and the sub-nav.
    longTitle: true,
  },
  {
    email: `neha.joshi@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Neha Joshi',
    slug: 'neha-joshi',
    designation: 'Assistant Professor',
    dept: 'CSE',
    about: 'Compiler optimisation and program analysis for heterogeneous hardware targets.',
    interests: ['Compilers', 'Program Analysis'],
    orcid: null,
    // Minimal profile all round — no project, no guidance — tests a "low completeness" faculty page.
    educationCount: 2, publicationCount: 1, positionCount: 1, awardCount: 1, courseCount: 1, hasProject: false, guidanceCount: 0, hasMembership: false,
  },
  {
    email: `ramesh.iyer@${EMAIL_DOMAIN}`,
    fullName: 'Dr. Ramesh Iyer',
    slug: 'ramesh-iyer',
    designation: 'Professor',
    dept: 'ECE',
    about: 'Senior faculty member with a long institutional service record spanning multiple administrative positions alongside an active research programme in signal processing.',
    interests: ['Digital Signal Processing', 'Communications'],
    orcid: '0000-0005-6789-0121',
    // Many positions — tests a long timeline in the Positions section.
    educationCount: 2, publicationCount: 3, positionCount: 4, awardCount: 2, courseCount: 2, hasProject: true, guidanceCount: 3, hasMembership: true,
  },
];

const LONG_PUBLICATION_TITLE =
  'A Comprehensive Investigation into Compliant Actuation Mechanisms for Lower-Limb Prosthetic Devices Operating Under Variable Load Conditions Across Heterogeneous Terrain Types, with Applications to Long-Term Rehabilitation Outcomes in Resource-Constrained Clinical Settings';

async function main() {
  console.log('Clearing existing data...');
  // Order matters: children before parents.
  await db.auditLog.deleteMany();
  await db.session.deleteMany();
  await db.verificationToken.deleteMany();
  await db.fileObject.deleteMany();
  await db.allowedEmail.deleteMany();
  await db.user.deleteMany();      // cascades to Profile and all sections
  await db.department.deleteMany();

  console.log('Creating departments...');
  const depts = new Map<string, string>();
  for (const d of DEPARTMENTS) {
    const created = await db.department.create({ data: d });
    depts.set(d.code, created.id);
  }

  console.log('Creating super admin...');
  await db.user.create({
    data: {
      email: `admin@${EMAIL_DOMAIN}`,
      role: Role.SUPER_ADMIN,
      status: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          fullName: 'System Administrator',
          slug: 'system-administrator',
          designation: 'Administrator',
          departmentId: depts.get('CSE')!,
          isPublished: false,
          researchInterests: [],
        },
      },
    },
  });

  console.log('Creating department admin (CSE)...');
  await db.user.create({
    data: {
      email: `suresh.menon@${EMAIL_DOMAIN}`,
      role: Role.DEPT_ADMIN,
      status: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      administersDepartmentId: depts.get('CSE'),
      profile: {
        create: {
          fullName: 'Dr. Suresh Menon',
          slug: 'suresh-menon',
          designation: 'Professor and Head of Department',
          departmentId: depts.get('CSE')!,
          about: 'Head of the Department of Computer Science and Engineering. Research interests in database systems and query optimisation.',
          researchInterests: ['Database Systems', 'Query Optimisation'],
          isPublished: true,
          publishedAt: new Date(),
          completeness: 70,
        },
      },
    },
  });

  console.log('Creating faculty with full profiles...');
  for (const f of FACULTY) {
    const user = await db.user.create({
      data: {
        email: f.email,
          role: Role.FACULTY,
        status: AccountStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        profile: {
          create: {
            fullName: f.fullName,
            slug: f.slug,
            designation: f.designation,
            departmentId: depts.get(f.dept)!,
            about: f.about,
            researchInterests: f.interests,
            officeNo: `Room ${Math.floor(Math.random() * 300) + 100}`,
            mobile: '+91 90000 00000',
            showMobile: false,
            orcid: f.orcid,
            isPublished: true,
            publishedAt: new Date(),
            completeness: 85,
          },
        },
      },
      include: { profile: true },
    });

    const profileId = user.profile!.id;

    await db.education.createMany({
      data: [
        { profileId, degree: 'Ph.D.', level: DegreeLevel.PHD, field: 'Engineering', institution: 'Indian Institute of Technology', yearTo: 2012, sortOrder: 0 },
        { profileId, degree: 'M.Tech.', level: DegreeLevel.MASTERS, field: 'Engineering', institution: 'National Institute of Technology', yearTo: 2007, sortOrder: 1 },
        { profileId, degree: 'B.Tech.', level: DegreeLevel.BACHELORS, field: 'Engineering', institution: 'University of Delhi', yearTo: 2005, sortOrder: 2 },
      ].slice(0, f.educationCount),
    });

    const publications = [
      { profileId, type: PublicationType.JOURNAL, title: f.longTitle ? LONG_PUBLICATION_TITLE : 'A Scalable Approach to Fault-Tolerant Coordination in Heterogeneous Clusters', authors: `${f.fullName}, Kumar S., Iyer M.`, venue: 'IEEE Transactions on Parallel and Distributed Systems', year: 2024, volume: '35', pages: '1120-1134', doi: `10.1109/TPDS.2024.${f.slug.length}00123`, sortOrder: 0 },
      { profileId, type: PublicationType.CONFERENCE, title: 'Adaptive Scheduling Under Partial Network Partitions', authors: `${f.fullName}, Das R.`, venue: 'ACM Symposium on Cloud Computing', year: 2023, sortOrder: 1 },
      { profileId, type: PublicationType.BOOK_CHAPTER, title: 'Foundations of Modern Systems Design', authors: f.fullName, publisher: 'Springer', year: 2021, sortOrder: 2 },
      { profileId, type: PublicationType.JOURNAL, title: 'Robust Estimation Techniques for Noisy Sensor Networks', authors: `${f.fullName}, Rao P.`, venue: 'Journal of Applied Sciences', year: 2020, volume: '12', pages: '55-70', sortOrder: 3 },
      { profileId, type: PublicationType.CONFERENCE, title: 'A Comparative Study of Optimisation Heuristics', authors: `${f.fullName}, Sen A., Bose K.`, venue: 'International Conference on Computing', year: 2019, sortOrder: 4 },
      { profileId, type: PublicationType.JOURNAL, title: 'Longitudinal Analysis of System Reliability Metrics', authors: f.fullName, venue: 'Reliability Engineering Review', year: 2017, volume: '8', pages: '201-215', sortOrder: 5 },
    ];
    await db.publication.createMany({ data: publications.slice(0, f.publicationCount) });

    const positions = [
      { profileId, title: 'Head of Department', organisation: 'College of Engineering', startYear: 2022, isCurrent: true, sortOrder: 0 },
      { profileId, title: 'Associate Professor', organisation: 'College of Engineering', startYear: 2018, endYear: 2022, sortOrder: 1 },
      { profileId, title: 'Assistant Professor', organisation: 'College of Engineering', startYear: 2013, endYear: 2018, sortOrder: 2 },
      { profileId, title: 'Postdoctoral Fellow', organisation: 'National Research Institute', startYear: 2011, endYear: 2013, sortOrder: 3 },
    ];
    await db.position.createMany({ data: positions.slice(0, f.positionCount) });

    if (f.awardCount > 0) {
      const awards = [
        { profileId, title: 'Best Paper Award', awardedBy: 'International Conference on Computing', year: 2023, sortOrder: 0 },
        { profileId, title: 'Young Researcher Award', awardedBy: 'Department of Science and Technology', year: 2016, sortOrder: 1 },
        { profileId, title: 'Excellence in Teaching Award', awardedBy: 'College of Engineering', year: 2020, sortOrder: 2 },
      ];
      await db.award.createMany({ data: awards.slice(0, f.awardCount) });
    }

    const courses = [
      { profileId, code: 'CS301', name: 'Operating Systems', level: CourseLevel.UG, semester: 'Odd', sortOrder: 0 },
      { profileId, code: 'CS502', name: 'Advanced Distributed Computing', level: CourseLevel.PG, semester: 'Even', sortOrder: 1 },
      { profileId, code: 'CS701', name: 'Research Methods in Computing', level: CourseLevel.PHD, semester: 'Odd', sortOrder: 2 },
    ];
    await db.course.createMany({ data: courses.slice(0, f.courseCount) });

    if (f.hasProject) {
      await db.researchProject.create({
        data: { profileId, type: ProjectType.SPONSORED, title: 'Resilient Infrastructure for Large-Scale Scientific Computing', agency: 'Science and Engineering Research Board', amountLakhs: 42.5, role: 'Principal Investigator', status: ProjectStatus.ONGOING, startDate: new Date('2023-04-01'), sortOrder: 0 },
      });
    }

    if (f.guidanceCount > 0) {
      const guidances = [
        { profileId, studentName: 'S. Banerjee', degree: GuidanceDegree.PHD, topic: 'Consensus protocols under adversarial latency', status: GuidanceStatus.ONGOING, startYear: 2022, sortOrder: 0 },
        { profileId, studentName: 'K. Rao', degree: GuidanceDegree.PHD, topic: 'Energy-aware task placement', status: GuidanceStatus.COMPLETED, startYear: 2017, awardYear: 2022, sortOrder: 1 },
        { profileId, studentName: 'M. Fernandes', degree: GuidanceDegree.MTECH, topic: 'Scalable indexing for time-series data', status: GuidanceStatus.COMPLETED, startYear: 2021, awardYear: 2023, sortOrder: 2 },
        { profileId, studentName: 'A. Pillai', degree: GuidanceDegree.PHD, topic: 'Formal methods for distributed consensus', status: GuidanceStatus.ONGOING, startYear: 2023, sortOrder: 3 },
      ];
      await db.guidance.createMany({ data: guidances.slice(0, f.guidanceCount) });
    }

    if (f.hasMembership) {
      await db.membership.create({
        data: { profileId, body: 'IEEE', membershipType: 'Senior Member', sinceYear: 2015, sortOrder: 0 },
      });
    }
  }

  console.log('Creating pending-approval accounts (for testing the department-scoped admin queue)...');
  await db.user.create({
    data: {
      email: `pending.mech@${EMAIL_DOMAIN}`,
      role: Role.FACULTY,
      status: AccountStatus.PENDING_APPROVAL,
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          fullName: 'Dr. Pending Mechanical',
          slug: 'pending-mechanical',
          departmentId: depts.get('ME')!,
          isPublished: false,
          researchInterests: [],
        },
      },
    },
  });

  await db.user.create({
    data: {
      email: `pending.cse@${EMAIL_DOMAIN}`,
      role: Role.FACULTY,
      status: AccountStatus.PENDING_APPROVAL,
      emailVerifiedAt: new Date(),
      profile: {
        create: {
          fullName: 'Dr. Pending Computing',
          slug: 'pending-computing',
          departmentId: depts.get('CSE')!,
          isPublished: false,
          researchInterests: [],
        },
      },
    },
  });

  console.log('\nSeed complete.');
  console.log('  Sign-in is by emailed code — there are no passwords.');
  console.log('  Request a code at /login, then read it from Mailpit: http://localhost:8025');
  console.log('');
  console.log(`  admin@${EMAIL_DOMAIN}            (SUPER_ADMIN)`);
  console.log(`  suresh.menon@${EMAIL_DOMAIN}     (DEPT_ADMIN, CSE)`);
  console.log(`  anita.sharma@${EMAIL_DOMAIN}     (FACULTY)`);
  console.log(`  pending.cse@${EMAIL_DOMAIN}      — sits in the CSE approval queue`);
  console.log(`  pending.mech@${EMAIL_DOMAIN}     — sits in the ME approval queue`);
  console.log(`  ${FACULTY.length} faculty profiles seeded across ${DEPARTMENTS.length} departments`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
