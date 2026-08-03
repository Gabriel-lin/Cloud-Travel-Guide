"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

import { getRouteCardCoverImage } from "@/components/routes/experience/route-configs";
import type { RouteExperienceConfig } from "@/components/routes/experience/types";
import { cn } from "@/lib/utils";

type RouteCardProps = {
  route: RouteExperienceConfig;
  region: string;
  title: string;
  summary: string;
  originLabel: string;
  enterLabel: string;
};

export function RouteCard({
  route,
  region,
  title,
  summary,
  originLabel,
  enterLabel,
}: RouteCardProps) {
  const coverImage = getRouteCardCoverImage(route);

  return (
    <Link
      href={`/routes/${route.slug}`}
      className={cn(
        "group relative block overflow-hidden rounded-2xl outline-none",
        "bg-surface-900/55 shadow-lg backdrop-blur-xl dark:bg-surface-900/35",
        "ring-1 ring-brand-500/15 ring-inset",
        "transition-all duration-300 ease-out",
        "hover:-translate-y-1 hover:bg-surface-900/70 hover:ring-brand-500/30",
        "dark:hover:bg-surface-900/45",
        "focus-visible:ring-2 focus-visible:ring-brand-500/60",
      )}
      style={
        {
          "--route-accent": route.accent,
        } as CSSProperties
      }
      aria-label={`${title} — ${enterLabel}`}
    >
      <article className="relative flex min-h-72 flex-col justify-end sm:min-h-75">
        {/* Origin scenery — semi-transparent；亮色下让照片更实一些，
            对比来自“实照片 + 干净信息条”，而不是整张卡糊成一片 */}
        <div className="absolute inset-0 opacity-[0.72] transition-opacity duration-300 group-hover:opacity-[0.82] dark:opacity-[0.52] dark:group-hover:opacity-[0.62]">
          <Image
            src={coverImage}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
            priority={route.slug === "silk-road"}
          />
        </div>

        {/* Fluid tech orbs */}
        <div
          className="route-card-fluid-orb pointer-events-none absolute left-[-18%] top-[8%] size-44 rounded-[42%_58%_65%_35%] bg-brand-500/20 blur-3xl"
          aria-hidden
        />
        <div
          className="route-card-fluid-orb-delayed pointer-events-none absolute right-[-12%] bottom-[28%] size-36 rounded-[58%_42%_38%_62%] blur-3xl"
          style={{
            backgroundColor: "color-mix(in srgb, var(--route-accent) 28%, transparent)",
          }}
          aria-hidden
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-linear-to-t",
            "from-surface-950/80 via-surface-950/40 to-surface-950/10",
            "dark:from-surface-950/75 dark:via-surface-950/25 dark:to-surface-950/10",
          )}
          aria-hidden
        />
        <div
          className="route-card-fluid-sheen pointer-events-none absolute inset-0 opacity-40 mix-blend-soft-light"
          aria-hidden
        />

        {/* Lower info — full-width glass strip */}
        <div className="relative mt-auto w-full border-t border-brand-500/10 bg-surface-950/55 px-4 py-4 backdrop-blur-md dark:bg-surface-950/20 sm:px-5 sm:py-5">
          <div
            className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-(--route-accent) to-transparent opacity-70"
            aria-hidden
          />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-brand-400">
                {region}
              </p>
              <span className="text-ink-400/60" aria-hidden>
                ·
              </span>
              <p className="font-mono text-[10px] tracking-wide text-ink-300/90">
                {originLabel}
              </p>
            </div>
            <h2 className="text-lg font-semibold leading-snug tracking-tight text-ink-100 sm:text-xl">
              {title}
            </h2>
            <p className="line-clamp-2 text-sm leading-relaxed text-ink-300/85">
              {summary}
            </p>
          </div>
        </div>
      </article>
    </Link>
  );
}
