{ self, config, lib, pkgs, ... }: 
  with lib;
  let 
    cfg = config.services.browserctl;
  in 
{
  options.services.browserctl = {
    enable = mkEnableOption "the browserctl service";

    package = mkOption {
      type = types.package;
      default = self.packages.x86_64-linux.default;
      defaultText = literalExpression "pkgs.browserctl";
      description = "browserctl package to use.";
    };

    browser-package = mkOption {
      type = types.package;
      default = packages.x86_64-linux.ungoogled-chromium;
      defaultText = literalExpression "pkgs.ungoogled-chromium";
      description = "browser package to use.";
    };

    url = mkOption {
      type = types.str;
      default = "";
      defaultText = "";
      description = "URL to load into default page";
    };

    socket-path = mkOption rec {
      type = types.path;
      default = "/tmp/browserctl.socket";
      defaultText = default;
      description = "Path to the control socket";
    };

    #TODO: use systemd variable interpolation to get the user
    user = mkOption rec {
      type = types.str;
      default = "autouser";
      defaultText = default;
      description = "User to run the service";
    };

  };

  config = mkIf cfg.enable {

    systemd.user.services.browserctl = {
      Unit = {
        Description = "Browser as a service";
        After = [ "graphical-session-pre.target" ];
        PartOf = [ "graphical-session.target" ];
      };
      Install = {
        WantedBy = [ "graphical-session.target" ];
      };
      Service = {
        Type = "notify";
        #TODO: new temp BrowserContext for each run
        ExecStartPre = "-${pkgs.coreutils-full}/bin/rm /home/${cfg.user}/.config/chromium/SingletonLock";
        #TODO: extraFlags?
        ExecStart = "${getExe cfg.package} new -S ${cfg.socket-path} --executablePath ${getExe cfg.browser-package} ${cfg.url}";
        Restart = "always";
        RestartSec = "5";
        WorkingDirectory = "/tmp";
        Environment = [
          "NODE_ENV=production"
          "DEBUG=browserctl"
        ];

        # NOTE: tail is used to Wait until the process is gone
        ExecStop="bash -c \"[[ -n $MAINPID ]] && kill -s SIGTERM $MAINPID && tail --pid=$MAINPID -f /dev/null\"";
        TimoutStopSec = "15";
        ExecReload = "${cfg.package}/bin/browserctl -t 0 -S ${cfg.socket-path} eval 'document.reload()'";

        StandardOutput = "null";
        StandardError = "journal";

        IPAddressDeny = "any";
        IPAddressAllow = [
          "127.0.0.1"
        ];
        #TODO: security restrictions
      };
    };
  };
}
