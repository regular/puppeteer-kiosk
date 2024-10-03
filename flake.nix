{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        buildInputs = with pkgs; [ 
          systemd
          #ungoogled-chromium
        ];
      in with pkgs; {

        packages.default = buildNpmPackage rec {
          name = "puppeteer-kiosk";
          src = ./.;
          npmDepsHash = "sha256-s51bKFCFJ220EvweB/RvPuZbeM/Z32orDu84j6HwGUM=";

          dontNpmBuild = true;
          makeCacheWritable = true;

          inherit buildInputs;
          nativeBuildInputs = [
            nodejs
            makeWrapper
            pkg-config
            python3
          ];

          postInstall = ''
            # Install the man page
            mkdir -p $out/share/man/man1
            cp man/man1/browserctl.1 $out/share/man/man1/
          '';

          #postInstall = ''
          #  wrapProgram $out/bin/puppeteer-kiosk \
          #  --set puppeteer-kiosk_ ${status-page}
          #'';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            ungoogled-chromium
            systemd
            nodejs
            pkg-config
            python3
          ];
        };
      }
    );
}
