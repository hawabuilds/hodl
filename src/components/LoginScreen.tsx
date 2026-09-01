"use client";

import {useEffect, useState} from "react";
import {useRouter} from "next/navigation";
import {APP_SUBTITLE} from "@/config/app";
import {useUser} from "@/hooks/useUser";
import {Button} from "./ui/Button";
import {
  ArrowRightIcon,
  ArrowUpIcon,
  MailIcon,
  VerifiedIcon,
  XIcon,
} from "./ui/Icons";
import {Logo} from "./ui/Logo";
import {Modal} from "./ui/Modal";

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
    <div className="scroll-quiet flex h-full flex-col overflow-y-auto bg-premium px-[30px] pb-[30px] pt-[26px]">
      <div className="flex items-center">
        <Logo />
      </div>

      <div className="flex flex-1 flex-col justify-center gap-7 pb-[22px] pt-1.5">
        <div>
          <h1 className="text-[clamp(28px,7.4vw,34px)] font-bold leading-[1.12] tracking-[-0.025em]">
            Every tokenized stock, and everything trading{" "}
            <span className="text-green-deep">against it</span>
          </h1>
          <p className="mt-3.5 max-w-[33ch] text-[16px] font-medium leading-[1.55] text-muted">
            {APP_SUBTITLE}
          </p>
        </div>

        <div
          aria-hidden="true"
          className="-rotate-[1.3deg] rounded-panel border border-hairline bg-card px-4 py-[15px] shadow-panel"
        >
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-extrabold">NVDA</span>
                <VerifiedIcon className="h-[15px] w-[15px] text-green" />
              </div>
              <div className="tnum mt-0.5 text-[12.5px] text-muted">
                $184.20 · Official RWA
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-pill border border-[rgba(0,200,5,0.24)] bg-[rgba(0,200,5,0.11)] px-3 py-2 text-[12px] font-bold text-green-deep">
              <ArrowUpIcon className="h-3 w-3" /> 2.14%
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2.5 border-t border-hairline pt-3">
            <div className="flex min-w-0 flex-col">
              <div className="text-[15px] font-extrabold">GPUCOIN</div>
              <div className="tnum mt-0.5 text-[12.5px] text-muted">
                $4.2M cap · paired NVDA
              </div>
            </div>
            <div className="tnum rounded-pill border border-[rgba(0,200,5,0.24)] bg-[rgba(0,200,5,0.11)] px-3 py-2 text-[12px] font-bold text-green-deep">
              +38.6%
            </div>
          </div>
        </div>

        <div>
          <Button size="lg" fullWidth onClick={() => setModalOpen(true)}>
            Get in
            <ArrowRightIcon className="h-4 w-4" />
          </Button>
          {isDemo && (
            <p className="mt-3 text-center text-[11.5px] font-medium text-faint">
              Demo mode — set NEXT_PUBLIC_PRIVY_APP_ID for real login.
            </p>
          )}
        </div>
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
        <button
          type="button"
          onClick={startLogin}
          className="mb-2.5 flex w-full items-center justify-center gap-3 rounded-[15px] border border-hairline bg-card px-4 py-[15px] text-[15px] font-bold text-ink transition-transform hover:-translate-y-px"
        >
          <MailIcon className="h-[18px] w-[18px]" />
          Continue with email
        </button>
        <p className="mx-auto mt-4 max-w-[32ch] text-center text-[11.5px] leading-[1.5] text-muted">
          A wallet is created for you on the way in. Nothing here executes a real
          trade.
        </p>
      </Modal>
    </div>
  );
}
