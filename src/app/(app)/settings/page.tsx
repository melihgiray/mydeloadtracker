import { createClient } from "@/lib/supabase/server";
import { getProfile, getWearableStatus } from "@/lib/data";
import { ProfileForm } from "@/components/profile-form";
import { WearableConnect } from "@/components/wearable-connect";
import { AppleHealthCard } from "@/components/apple-health-card";
import { SignOutButton } from "@/components/sign-out-button";
import { ouraConfigured } from "@/lib/wearables/oura";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ wearable?: string | string[] }>;
}) {
  const { wearable } = await searchParams;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = await getProfile(supabase);
  const [oura, apple] = await Promise.all([
    getWearableStatus(supabase, "oura"),
    getWearableStatus(supabase, "apple_health"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          Signed in as {user?.email}. Manage your profile and preferences.
        </p>
      </div>
      <ProfileForm profile={profile} />
      <AppleHealthCard connected={apple.connected} lastSync={apple.lastSync} />
      <WearableConnect
        configured={ouraConfigured()}
        connected={oura.connected}
        lastSync={oura.lastSync}
        status={Array.isArray(wearable) ? wearable[0] : wearable}
      />

      <div className="border-t border-border pt-6">
        <SignOutButton />
      </div>
    </div>
  );
}
