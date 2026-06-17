export type UserProfile = {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  preferences?: string[];
  locale?: string;
  avatarUrl?: string;
  provider?: "local" | "github" | "google";
};

export type UpdateProfilePayload = Partial<
  Pick<UserProfile, "displayName" | "preferences" | "locale" | "avatarUrl">
>;
