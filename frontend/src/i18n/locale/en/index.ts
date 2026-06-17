import auth from "./auth.json";
import nav from "./nav.json";
import plan from "./plan.json";
import profile from "./profile.json";
import routes from "./routes.json";
import saved from "./saved.json";
import settings from "./settings.json";

const en = {
  settings,
  nav,
  auth,
  profile,
  plan,
  routes,
  saved,
} as const;

export default en;
