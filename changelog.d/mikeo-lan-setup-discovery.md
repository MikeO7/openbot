### Added

- A Docker or self-hosted server with host networking and `OPENBOT_LAN_SETUP=1` announces itself on
  the local network while it is not signed in, as `_openbot-setup._tcp`. The announcement has only the
  server name and a random setup ID, and it ends when the server signs in. The apps do not use it yet.
