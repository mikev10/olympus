# The image a task runs in: Node, and the Claude Code CLI at one version.
#
# Built by this package rather than pulled, because no published image carries
# the CLI. Both inputs are pinned — the base by digest, the CLI by exact
# version — so the image a reviewer builds is the image CI built. The build
# happens on the host, where the network is the developer's own; the container
# this produces reaches only what the sandbox's egress allowlist grants it.
#
# Nothing is copied in from the repository. The workspace arrives at run time
# as the sandbox's one writable mount, so the image holds no project code and
# a stale image cannot serve a task an old copy of the tree.
ARG BASE
FROM ${BASE}

ARG CLI_VERSION
RUN npm install --global --no-fund --no-audit "@anthropic-ai/claude-code@${CLI_VERSION}"  && npm cache clean --force

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
