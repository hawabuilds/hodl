"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {useUser} from "@/hooks/useUser";
import {Button} from "./ui/Button";
import {AppleIcon, ArrowRightIcon, XIcon} from "./ui/Icons";
import {Modal} from "./ui/Modal";

/**
 * The landing page.
 *
 * One claim, one line of explanation, one thing to press. Everything that used
 * to sit between them — a mark, a sample card, a paragraph of positioning —
 * was competing with the only decision on the screen.
 */
export function LoginScreen() {
  const router = useRouter();
  const {ready, authenticated, login, isDemo} = useUser();
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (ready && authenticated) router.replace("/home");
  }, [ready, authenticated, router]);

  const startLogin = () => {
    setModalOpen(false);
    login();
  };

  return (
    <div className="flex h-full flex-col justify-center bg-premium px-8 pb-[max(48px,env(safe-area-inset-bottom))]">
      <h1 className="text-[clamp(38px,11vw,46px)] font-extrabold leading-[1.02] tracking-[-0.045em]">
        RWA app for
        <br />
        <span className="text-green-deep">trenchers</span>
      </h1>

      <p className="mt-5 max-w-[24ch] text-[17px] font-medium leading-[1.45] text-muted">
        Everything you need for Robinhood Chain.
      </p>

      <div className="mt-11 flex flex-col gap-2.5">
        <Button size="lg" fullWidth onClick={() => setModalOpen(true)}>
          Join now
          <ArrowRightIcon className="h-4 w-4" />
        </Button>

        <button
          type="button"
          disabled
          aria-label="iOS app coming soon"
          className="flex w-full items-center justify-center gap-2.5 rounded-[17px] border border-hairline bg-card px-5 py-[18px] text-[16px] font-bold tracking-[-0.01em] text-faint"
        >
          <AppleIcon className="h-[19px] w-[19px]" />
          Coming soon
        </button>

        {isDemo ? (
          <p className="mt-2 text-center text-[11.5px] font-medium text-faint">
            Demo mode — set NEXT_PUBLIC_PRIVY_APP_ID for real login.
          </p>
        ) : null}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Log in or create an account"
      >
        <button
          type="button"
          onClick={startLogin}
          className="mb-2.5 flex w-full items-center justify-center gap-3 rounded-[15px] border border-btn-dark bg-btn-dark px-4 py-[15px] text-[15px] font-bold text-btn-dark-fg shadow-[0_12px_26px_-14px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-px"
        >
          <XIcon className="h-[18px] w-[18px]" />
          Continue with X
        </button>
        <p className="mx-auto mt-4 max-w-[32ch] text-center text-[11.5px] leading-[1.5] text-muted">
          A wallet is created for you on the way in. Nothing here executes a real
          trade.
        </p>
      </Modal>
    </div>
  );
}
