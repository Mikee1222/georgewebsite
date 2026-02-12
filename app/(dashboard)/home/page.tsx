'use client';

import LuxuryHome from '@/app/components/home/LuxuryHome';

export default function HomePage() {
  return (
    <div className="home-page flex min-h-0 w-full min-w-0 max-w-[100%] flex-col items-stretch justify-start overflow-x-hidden md:min-h-[100dvh]">
      <div className="w-full min-w-0 max-w-[100%] px-0 pt-4 pb-6 md:px-0 md:py-6 lg:mx-auto lg:max-w-[1150px]">
        <LuxuryHome />
      </div>
    </div>
  );
}
