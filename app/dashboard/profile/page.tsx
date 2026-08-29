import type { Metadata } from 'next';

import { CvUpload } from '@/components/dashboard/cv-upload';
import { PersonalDetailsForm } from '@/components/dashboard/personal-details-form';
import { PhotoUpload } from '@/components/dashboard/photo-upload';
import { TagInput } from '@/components/dashboard/tag-input';
import { SlugEditor } from '@/components/dashboard/slug-editor';
import { requireSessionOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { getPublicUrl } from '@/lib/storage';

export const metadata: Metadata = { title: 'Personal details' };
export const dynamic = 'force-dynamic';

export default async function ProfileFilesPage() {
  const session = await requireSessionOrRedirect('/dashboard/profile');

  const profile = await db.profile.findUnique({
    where: { id: session.profileId },
    select: {
      photoKey: true, cvKey: true, fullName: true, designation: true, officeNo: true,
      mobile: true, phoneExt: true, altEmail: true, about: true, personalPageUrl: true, linkedinUrl: true,
      orcid: true, scopusId: true, googleScholarId: true, researcherId: true,
      showMobile: true, showPhoneExt: true, showAltEmail: true, researchInterests: true,
      slug: true, isPublished: true,
    },
  });

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Profile
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">
          Personal details
        </h1>

        <div className="mt-12 space-y-14">
          <SlugEditor
            initialSlug={profile?.slug ?? 'faculty-profile'}
            isPublished={profile?.isPublished ?? false}
          />
          <hr className="border-hairline" />
          <PhotoUpload currentUrl={profile?.photoKey ? getPublicUrl(profile.photoKey) : null} />
          <hr className="border-hairline" />
          <CvUpload currentUrl={profile?.cvKey ? getPublicUrl(profile.cvKey) : null} />
          <hr className="border-hairline" />
          <TagInput initial={profile?.researchInterests ?? []} />
          <hr className="border-hairline" />
          <PersonalDetailsForm
            initial={{
              fullName: profile?.fullName ?? '',
              designation: profile?.designation ?? '',
              officeNo: profile?.officeNo ?? '',
              mobile: profile?.mobile ?? '',
              phoneExt: profile?.phoneExt ?? '',
              altEmail: profile?.altEmail ?? '',
              about: profile?.about ?? '',
              personalPageUrl: profile?.personalPageUrl ?? '',
              linkedinUrl: profile?.linkedinUrl ?? '',
              orcid: profile?.orcid ?? '',
              scopusId: profile?.scopusId ?? '',
              googleScholarId: profile?.googleScholarId ?? '',
              researcherId: profile?.researcherId ?? '',
              showMobile: profile?.showMobile ?? false,
              showPhoneExt: profile?.showPhoneExt ?? true,
              showAltEmail: profile?.showAltEmail ?? true,
            }}
          />
        </div>
      </div>
    </main>
  );
}
