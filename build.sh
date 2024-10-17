set -eux
nix build . --builders ''                                                                                                                                                     
export KIOSK=$(realpath result/bin/puppeteer-kiosk)                                                                                                                           
sudo rm -rf /tmp/browserctl.socket                                                                                                                                            
sudo machinectl shell autouser@.host /run/current-system/sw/bin/bash -c "DEBUG=$DEBUG WAYLAND_DISPLAY=$WAYLAND_DISPLAY $KIOSK --wayland --fast-exit --executablePath $CHROME"

