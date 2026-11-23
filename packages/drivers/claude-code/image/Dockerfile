# The image a task runs in: Node, and the Claude Code CLI by content.
#
# Built by this package rather than pulled, because no published image carries
# the CLI. Every input is pinned: the base by digest, and the CLI and each of
# its platform packages by sha512 in cli-lock.json (R53). The build
# happens on the host, where the network is the developer's own; the container
# this produces reaches only what the sandbox's egress allowlist grants it.
#
# Nothing is copied in from the repository but this directory's manifest,
# lockfile, and install check. The workspace arrives at run time as the
# sandbox's one writable mount, so the image holds no project code and a
# stale image cannot serve a task an old copy of the tree.
ARG BASE
FROM ${BASE}

# From the lockfile and never by name: `npm ci` installs exactly what it pins
# and checks each tarball against its sha512. It skips an optional platform
# package whose tarball fails that check, so check-install.js then fails the
# build unless every package pinned for this platform is installed as locked.
# Root owns all of it, so a task's user cannot rewrite the CLI or the check.
# The lockfile is committed as cli-lock.json because a packed package never
# carries a file named package-lock.json, and a driver installed from the
# registry would then have none to build from. npm reads it under its own name.
COPY package.json check-install.js /opt/cli/
COPY cli-lock.json /opt/cli/package-lock.json
RUN cd /opt/cli \
    && npm ci --no-fund --no-audit \
    && node check-install.js /opt/cli \
    && npm cache clean --force \
    && ln -s /opt/cli/node_modules/.bin/claude /usr/local/bin/claude

# A task's commands run as a user that does not own the CLI it runs, so a model
# that rewrites its own binary is refused by the filesystem rather than by
# trust. The workspace mount is the one thing it may write.
#
# The base image's own `node` user rather than a new one: it is uid 1000, which
# is the uid a checkout on an ordinary Linux host and on CI already belongs to,
# so the bind-mounted workspace is writable without the image having to guess.
# A user created here would land on 1001 and be unable to write its own
# workspace on exactly the hosts that matter.
USER node
ENV HOME=/home/node

# No ENTRYPOINT: the provider starts the container with its own keep-alive and
# every command arrives through `docker exec`.
