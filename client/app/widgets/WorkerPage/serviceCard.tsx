import * as React from "react";
import { Link } from "react-router";
import { cn } from "~/lib/utils";
import { IconArrowRight } from "~/widgets/kit";
import type { Services } from "~/models/workerPage";


interface ServiceCardProps extends React.HTMLAttributes<HTMLDivElement> {
  service: Services,
  slug: String
}

const THEME_COLOR = "218 87% 35%";

const ServiceCard = React.forwardRef<HTMLDivElement, ServiceCardProps>(
  ({ className, service, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          "--theme-color": THEME_COLOR,
          ...style,
        } as React.CSSProperties}
        className={cn("group w-full h-full", className)}
        {...props}
      >
        <div
          className="relative block w-full h-full rounded-2xl overflow-hidden
                     shadow-[0_0_40px_-15px_hsl(var(--theme-color)/0.5)]
                     transition-all duration-500 ease-in-out
                     group-hover:scale-105 group-hover:shadow-[0_0_60px_-15px_hsl(var(--theme-color)/0.6)]"
        >

          <div
            className="absolute inset-0 bg-cover bg-center 
                       transition-transform duration-500 ease-in-out group-hover:scale-110"
            style={{ backgroundImage: `url(${service.image})` }}
          />

          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to top, hsl(var(--theme-color) / 0.9), hsl(var(--theme-color) / 0.6) 30%, transparent 60%)`,
            }}
          />
          
          <div className="relative flex flex-col justify-end h-full p-6 text-ink">
            <h3 className="text-3xl font-bold tracking-tight">
              {`${service.title}`}
            </h3>
            <p className="text-sm text-ink-secondary mt-1">{service.description}</p>

            <Link
              to={`/view-services/${ service.duration_min }`}
              className="mt-8 flex items-center justify-between bg-[hsl(var(--theme-color)/0.2)] backdrop-blur-md border border-[hsl(var(--theme-color)/0.3)]
                  rounded-lg px-4 py-3
                  transition-all duration-120
                  active:scale-[0.98]
                  group-hover:bg-[hsl(var(--theme-color)/0.4)] group-hover:border-[hsl(var(--theme-color)/0.5)]"
            >
              <span className="text-sm font-semibold tracking-wide">Book Now</span>
              <IconArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>

          </div>
        </div>
      </div>
    );
  }
);
ServiceCard.displayName = "ServiceCard";

export { ServiceCard };