import { withPluginApi } from "discourse/lib/plugin-api";

const PLUGIN_ID = "discourse-video-shorts";

export default {
  name: "video-shorts-admin-plugin-configuration-nav",

  initialize(container) {
    const currentUser = container.lookup("service:current-user");
    if (!currentUser?.admin) {
      return;
    }

    withPluginApi((api) => {
      api.setAdminPluginIcon(PLUGIN_ID, "video");
      api.addAdminPluginConfigurationNav(PLUGIN_ID, [
        {
          label: "video_shorts.admin.diagnostics.title",
          route: "adminPlugins.show.video-shorts-diagnostics",
          description: "video_shorts.admin.diagnostics.description",
        },
      ]);
    });
  },
};
