"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DEVICE_COOKIE, HEARTBEAT_MS, deviceIdFromCookie } from "@/lib/telemetry";

const NOTICE_KEY = "ai-dj:telemetry-notice";
const TWO_YEARS_S = 60 * 60 * 24 * 730;

/** This browser's anonymous device id: the one in its cookie, or a new one made now and stored for two years. */
function ensureDeviceId(): string {
  const existing = deviceIdFromCookie(document.cookie);
  if (existing) return existing;
  const id = crypto.randomUUID();
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${DEVICE_COOKIE}=${id}; Path=/; Max-Age=${TWO_YEARS_S}; SameSite=Lax${secure}`;
  return id;
}

/**
 * Tells the server this device has the app open: every 30 seconds while the page is showing (and once as soon as it shows again), with
 * the anonymous device id, a session id for this stretch of use, the platform and the app version. Shows a short notice, once, that
 * usage and device data is collected. Renders nothing else.
 */
export function TelemetryClient() {
  const [showNotice, setShowNotice] = useState(false);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    const deviceId = ensureDeviceId();
    const sessionId = (sessionRef.current ??= crypto.randomUUID());
    const send = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/telemetry/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, sessionId, platform: "web", appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown" }),
        keepalive: true,
      }).catch(() => {});
    };
    send();
    const timer = setInterval(send, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", send);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", send);
    };
  }, []);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(NOTICE_KEY)) setShowNotice(true); // eslint-disable-line react-hooks/set-state-in-effect -- read once after mount: storage does not exist on the server
    } catch {
      // storage blocked: the notice just is not remembered, so it shows once per visit
      setShowNotice(true);
    }
  }, []);

  if (!showNotice) return null;
  return (
    <div
      role="region"
      aria-label="Usage data notice"
      className="fixed bottom-[calc(var(--player-h,4.5rem)+4.5rem)] left-3 right-3 z-[60] mx-auto max-w-md rounded-xl border border-border-subtle bg-surface p-3 text-xs shadow-elevate-md tablet:bottom-24 tablet:left-4 tablet:right-auto"
    >
      <p className="text-muted">
        This app records usage and device data (an anonymous device ID, your device type, and what is played, uploaded and changed) so
        its owner can see how it is used. It has no name or email in it.{" "}
        <Link href="/privacy" className="text-accent underline">
          Privacy Policy
        </Link>
      </p>
      <button
        type="button"
        className="btn-outline !text-xs mt-2"
        onClick={() => {
          setShowNotice(false);
          try {
            window.localStorage.setItem(NOTICE_KEY, "seen");
          } catch {
            // not remembered
          }
        }}
      >
        Got it
      </button>
    </div>
  );
}
