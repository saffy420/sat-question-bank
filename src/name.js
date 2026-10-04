// Account names come from the identity provider. Ours prefixes them with a forward slash ("/Leon Chakraborty"),
// which then shows on the rail, the lesson roster and the admin pages; slashes are dropped wherever a name is read.
// public/index.html applies the same rule to the name it shows; data-fixes/main/0001_user_name_slashes.sql cleans
// names already stored in `users`.
export const cleanName = s => String(s ?? '').replace(/\//g, '').replace(/\s+/g, ' ').trim();
// The display name of a Supabase user: full_name, then name; '' when neither has anything left.
export const accountName = u => cleanName(u?.user_metadata?.full_name) || cleanName(u?.user_metadata?.name);
