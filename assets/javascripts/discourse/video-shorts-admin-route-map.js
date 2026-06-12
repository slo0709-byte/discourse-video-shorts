export default {
  resource: "admin.adminPlugins.show",
  path: "/plugins",
  map() {
    this.route("video-shorts-diagnostics", { path: "diagnostics" });
  },
};
