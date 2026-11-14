import { useNavigation, useSearchParams } from "react-router";
import { Container } from "~/widgets/kit";
import { SiteHeader } from "~/widgets/siteHeader";
import { CompanyFooter } from "~/widgets/companyFooter";
import { OnboardingWizard, type StepKey } from "~/widgets/Dashboard/onboarding";
import { PROFILE_FORM, WorkerProfileForm } from "~/widgets/Dashboard/workerProfile";
import { SHOP_FORM } from "~/widgets/Dashboard/connectShop";
import { ADD_SHOP_FORM } from "~/widgets/Dashboard/addShop";
import { ShopStep } from "~/widgets/Dashboard/shopStep";
import { HOURS_FORM, WorkerHoursForm } from "~/widgets/Dashboard/schedule";
import { SERVICES_FORM, ServicesForm } from "~/widgets/Dashboard/services";
import { GoLive } from "~/widgets/Dashboard/goLive";
import type { MyChair, MyService, SaveWorkerProfile } from "~/models/dashboard";

/* Setup for a worker whose page isn't live yet. The step comes from the loader,
   so a refresh or the back button lands on the same one. */

// The form each step's Next submits. A step without one has nothing to save yet.
const FORMS: Partial<Record<StepKey, string>> = {
  profile: PROFILE_FORM,
  shop: SHOP_FORM,
  schedule: HOURS_FORM,
  services: SERVICES_FORM,
};

type Props = {
  step: StepKey;
  profile: SaveWorkerProfile;
  chairs: MyChair[];
  /** The chair the hours step edits: the request still waiting, else the first chair. */
  chair: MyChair | null;
  services: MyService[];
  /** True once the worker's page is public. */
  live: boolean;
  error: string | null;
};

type BodyProps = Props & { adding: boolean; onChoose: (add: boolean) => void };

function StepBody({ step, profile, chairs, chair, services, live, error, adding, onChoose }: BodyProps) {
  if (step === "profile") return <WorkerProfileForm profile={profile} error={error} />;
  if (step === "shop") return <ShopStep adding={adding} onChoose={onChoose} chairs={chairs} error={error} />;
  if (step === "schedule" && chair) return <WorkerHoursForm chair={chair} error={error} />;
  if (step === "services") return <ServicesForm services={services} error={error} />;
  return <GoLive live={live} chairs={chairs} chair={chair} services={services} slug={profile.slug} />;
}

export function Onboarding(props: Props) {
  // formMethod stays "POST" through the redirect to the next step, when state has already moved to "loading".
  const busy = useNavigation().formMethod === "POST";

  // ?shop=new picks "Add my shop". Replacing the entry keeps Back on the previous step.
  const [params, setParams] = useSearchParams();
  const adding = props.step === "shop" && params.get("shop") === "new";
  const choose = (add: boolean) =>
    setParams(
      (p) => {
        if (add) p.set("shop", "new");
        else p.delete("shop");
        return p;
      },
      { replace: true, preventScrollReset: true },
    );

  return (
    <div className="overflow-x-clip bg-canvas-soft text-ink">
      <SiteHeader company={false} />
      <main>
        <section className="py-16 md:py-24 lg:py-32">
          <Container>
            <h1 className="font-display text-display-1 text-ink">Set up your page</h1>
            <p className="mt-6 max-w-2xl text-pretty text-body-md text-ink-secondary">
              A few steps, then clients can book you.
            </p>

            <div className="mt-10 max-w-md">
              <OnboardingWizard step={props.step} form={adding ? ADD_SHOP_FORM : FORMS[props.step]} busy={busy}>
                <StepBody {...props} adding={adding} onChoose={choose} />
              </OnboardingWizard>
            </div>
          </Container>
        </section>
      </main>
      <CompanyFooter />
    </div>
  );
}
