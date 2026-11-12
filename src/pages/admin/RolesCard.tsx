// Who is a member, a commissioner, or an admin. The list is this season's
// roster. The role itself is stored once per profile, not once per season.
// Only an admin can save. A commissioner can read the list.

import { IdCard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { canAssignRoles, useAuth } from "../../auth";
import { getSupabase } from "../../supabaseClient";
import { fail, SaveButtonView, useSaveFlash, type AdminNotice, type Season } from "./adminShared";

type Person = { id: string; name: string; role: string };

export function RolesCard({ season, saved, failed }: AdminNotice & { season: Season }) {
  const { role } = useAuth();
  const assignRoles = canAssignRoles(role);
  const [people, setPeople] = useState<Person[]>([]);
  const { flash, run } = useSaveFlash();

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const [{ data: memberRows, error: memberError }, { data: roleRows, error: roleError }] = await Promise.all([
      supabase.from("season_members").select("profile_id, profiles(display_name)").eq("season_id", season.id),
      supabase.from("user_roles").select("profile_id, role"),
    ]);
    fail(memberError, "read roster");
    fail(roleError, "read roles");
    const roles = new Map((roleRows ?? []).map((row) => [String(row.profile_id), String(row.role)]));
    setPeople(
      (memberRows ?? [])
        .map((row) => {
          const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
          return {
            id: String(row.profile_id),
            name: profile?.display_name ?? "Unknown",
            role: roles.get(String(row.profile_id)) ?? "",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, [season.id]);

  useEffect(() => {
    load().catch((reason: unknown) => failed(reason, "Could not load roles."));
  }, [load, failed]);

  async function saveRoles() {
    if (!assignRoles) throw new Error("Only an admin can assign roles.");
    const supabase = getSupabase();
    for (const person of people) {
      if (!person.role) {
        const { error } = await supabase.from("user_roles").delete().eq("profile_id", person.id);
        fail(error, "clear role");
      } else {
        const { error } = await supabase.from("user_roles").upsert({ profile_id: person.id, role: person.role }, { onConflict: "profile_id" });
        fail(error, "save role");
      }
    }
    saved("Roles saved.");
  }

  return (
    <form
      className="admin-card tone-roles"
      onSubmit={(event) => {
        event.preventDefault();
        run(saveRoles, failed, "Could not save roles.");
      }}
    >
      <h2>
        <IdCard aria-hidden="true" />
        Roles
      </h2>
      <p className="field-help">
        A member can fill in and check off their own tasks, including past days. A commissioner can also edit anyone's tasks, create teams, move players between teams, and set point values. Only an admin can change these roles.
      </p>
      <ul className="admin-list">
        {people.map((person) => (
          <li key={person.id}>
            <span>{person.name}</span>
            <select
              value={person.role}
              disabled={!assignRoles}
              onChange={(event) => setPeople(people.map((item) => (item.id === person.id ? { ...item, role: event.target.value } : item)))}
            >
              <option value="">Member access only</option>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="commissioner">Commissioner</option>
            </select>
          </li>
        ))}
      </ul>
      {assignRoles ? <SaveButtonView label="Save roles" flash={flash} /> : <p className="field-help">Only an admin can assign roles.</p>}
    </form>
  );
}
