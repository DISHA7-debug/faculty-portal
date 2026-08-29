'use client';

import { ExternalLink, Check, Pencil, Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { updateSlugAction } from '@/app/dashboard/profile/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SlugEditor({
  initialSlug,
  isPublished,
}: {
  initialSlug: string;
  isPublished: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [slug, setSlug] = useState(initialSlug);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateSlugAction(slug);
      if (res.ok) {
        toast.success(`Profile URL updated to /faculty/${res.slug}`);
        setIsEditing(false);
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to update URL handle.');
      }
    });
  };

  return (
    <div className="rounded-xl border border-hairline bg-surface-raised p-5 shadow-xs">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-primary" />
          <span className="text-[0.85rem] font-medium">Unique Profile URL Handle</span>
        </div>

        {!isEditing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="mr-1 size-3" /> Edit Handle
          </Button>
        ) : null}
      </div>

      <div className="mt-3">
        {!isEditing ? (
          <div className="flex items-center gap-2 font-mono text-[0.85rem]">
            <span className="text-muted-foreground">/faculty/</span>
            <span className="font-semibold text-foreground">{initialSlug}</span>
            <a
              href={`/faculty/${initialSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 inline-flex items-center text-[0.75rem] text-primary hover:underline"
            >
              View page <ExternalLink className="ml-1 size-3" />
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[0.85rem] text-muted-foreground">/faculty/</span>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="e.g. anita-sharma-cse"
                className="h-9 font-mono text-xs max-w-xs"
              />
            </div>
            <p className="text-[0.75rem] text-muted-foreground">
              Letters, numbers, and hyphens only. Must be unique across all faculty profiles.
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={pending} className="h-8 text-xs">
                <Check className="mr-1 size-3" /> Save Handle
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSlug(initialSlug);
                  setIsEditing(false);
                }}
                disabled={pending}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
