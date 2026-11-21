'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';

export default function Home() {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(me ? '/dashboard' : '/login');
  }, [loading, me, router]);
  return (
    <div className="grid min-h-screen place-items-center">
      <Spinner />
    </div>
  );
}
