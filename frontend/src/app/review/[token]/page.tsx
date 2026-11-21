'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { errorText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { PublicLoading, PublicShell, SuccessMark } from '@/components/public-shell';

const MOODS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
const STAR = 'm12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z';

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<{ business: string; firstName: string; completed: boolean } | null>(null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ publicReviewUrl: string | null } | null>(null);

  useEffect(() => {
    api(`/public/reviews/${token}`, { auth: false }).then(setInfo).catch((e) => setError(errorText(e)));
  }, [token]);

  if (!info) return <PublicLoading error={error} brand={{ kind: 'review', key: token }} />;
  const shown = hover || rating;

  return (
    <PublicShell center brand={{ kind: 'review', key: token }}>
      <div className="card mx-auto w-full max-w-md p-7 text-center shadow-pop sm:p-8">
        {info.completed && !done ? (
          <>
            <SuccessMark />
            <p className="font-semibold">You've already left a review — thank you!</p>
          </>
        ) : done ? (
          <div role="status">
            <SuccessMark />
            <h1 className="text-xl font-semibold tracking-tight">Thank you, {info.firstName}!</h1>
            {done.publicReviewUrl ? (
              <>
                <p className="mt-2 text-sm text-slate-600">Would you share that on our public review page too? It helps other people find us.</p>
                <a href={done.publicReviewUrl} target="_blank" rel="noopener noreferrer" className="btn-primary mt-5 h-11 w-full text-[15px]">
                  Post a public review <Icon name="external" className="h-4 w-4" />
                </a>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-600">Your feedback went straight to our team. We'll use it to do better.</p>
            )}
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!rating) return setError('Please choose a rating');
              setBusy(true);
              setError('');
              try {
                setDone(await api(`/public/reviews/${token}`, { method: 'POST', auth: false, body: { rating, comment: comment || undefined } }));
              } catch (err) {
                setError(errorText(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-md shadow-amber-500/25">
              <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d={STAR} /></svg>
            </span>
            <p className="mt-4 text-sm text-slate-500">Hi {info.firstName},</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">How was your experience with {info.business}?</h1>
            <fieldset className="mt-6">
              <legend className="sr-only">Rating</legend>
              <div className="flex justify-center gap-1.5" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer rounded-lg p-0.5 transition hover:scale-110 has-[:focus-visible]:shadow-glow" onMouseEnter={() => setHover(n)}>
                    <input type="radio" name="rating" value={n} className="sr-only" checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} />
                    <svg aria-hidden viewBox="0 0 24 24" className={`h-10 w-10 transition-colors ${shown >= n ? 'fill-amber-400' : 'fill-slate-200'}`}><path d={STAR} /></svg>
                  </label>
                ))}
              </div>
              <p className="mt-2 h-5 text-sm font-medium text-amber-600" aria-live="polite">{MOODS[shown]}</p>
            </fieldset>
            <label className="mt-4 block text-left">
              <span className="label">{rating && rating < 4 ? 'What could we have done better?' : 'Anything you want to share? (optional)'}</span>
              <textarea rows={4} className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
            {error && <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p>}
            <button className="btn-primary mt-5 h-11 w-full text-[15px]" disabled={busy}>{busy ? 'Sending…' : 'Submit review'}</button>
          </form>
        )}
      </div>
    </PublicShell>
  );
}
