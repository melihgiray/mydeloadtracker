import { createClient } from "@/lib/supabase/server";
import { getProfile, getWearableStatus } from "@/lib/data";
import { ProfileForm } from "@/components/profile-form";
import { WearableConnect } from "@/components/wearable-connect";
import { ouraConfigured } from "@/lib/wearables/oura";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { wearable?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = await getProfile(supabase);
  const oura = await getWearableStatus(supabase, "oura");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          Signed in as {user?.email}. Manage your profile and preferences.
        </p>
      </div>
      <ProfileForm profile={profile} />
      <WearableConnect
        configured={ouraConfigured()}
        connected={oura.connected}
        lastSync={oura.lastSync}
        status={searchParams?.wearable}
      />
    </div>
  );
}
