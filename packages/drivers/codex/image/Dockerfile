# The image a task runs in: Node, the Codex CLI by content, and the model
# catalogs the driver hands it.
#
# Built by this package rather than pulled, because no published image carries
# the CLI. Every input is pinned: the base by digest, and the CLI and each of
# its platform packages by sha512 in package-lock.json (R53). The build runs
# on the host, where the network is the developer's own; the container this
# produces reaches only what the sandbox's egress allowlist and relay grant it.
#
# Nothing from the project is copied in but this directory's manifest,
# lockfile, install check, and catalog generator. The workspace arrives at run
# time as the sandbox's one writable mount.
ARG BASE
FROM ${BASE}

# From the lockfile and never by name: `npm ci` installs exactly what it pins
# and checks each tarball against its sha512. It skips an optional platform
# package whose tarball fails that check, so check-install.js then fails the
# build unless every package pinned for this platform is installed as locked.
# Root owns all of it, so a task's user cannot rewrite the CLI or the check.
COPY package.json package-lock.json check-install.js /opt/cli/
RUN cd /opt/cli \
    && npm ci --no-fund --no-audit \
    && node check-install.js /opt/cli \
    && npm cache clean --force \
    && ln -s /opt/cli/node_modules/.bin/codex /usr/local/bin/codex

# The catalogs (D-R26-04), written from the catalog the pinned CLI ships and
# owned by root: a task's commands run as another user and cannot rewrite what
# configures a later task's session. The CLI's home for this one command is a
# directory removed afterwards, so the image keeps no state of the build's.
COPY catalog.js /opt/codex/catalog.js
RUN set -eu; \
    home="$(mktemp -d)"; \
    CODEX_HOME="$home" codex debug models --bundled > /opt/codex/bundled.json; \
    node /opt/codex/catalog.js /opt/codex/bundled.json /opt/codex; \
    rm -rf "$home" /opt/codex/bundled.json; \
    chmod 0755 /opt/codex; chmod 0644 /opt/codex/*.json /opt/codex/catalog.js

# Where each invocation makes its own home (D-R26-09). Sticky and writable by
# every uid, because the sandbox runs as the runtime's uid, which on a GitHub
# runner is not the image's. Outside /tmp, where the CLI refuses to put its
# helper binaries.
RUN mkdir -m 1777 /codex-homes

# A task's commands run as a user that does not own the CLI it runs, so a model
# that rewrites its own binary is refused by the filesystem rather than by
# trust. The base image's own `node` user, uid 1000, for the reason the Claude
# Code driver's image gives.
USER node
ENV HOME=/home/node

# No ENTRYPOINT: the provider starts the container with its own keep-alive and
# every command arrives through `docker exec`.
