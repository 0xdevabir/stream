# syntax=docker/dockerfile:1
#
# The edge. Serves the web app, the API, and -- the part that matters for cost
# -- live segments straight off disk with sendfile. This is the process that
# scales to thousands of viewers, so it stays deliberately boring.

FROM nginx:1.27-alpine

# The official entrypoint runs envsubst over /etc/nginx/templates/*.template
# and writes the result into /etc/nginx/conf.d/, substituting only names that
# exist in the environment -- so nginx's own $variables pass through untouched.
COPY infra/nginx/stream.conf.template /etc/nginx/templates/stream.conf.template

# Ships a "welcome" server on port 80 that would shadow our default_server.
RUN rm -f /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
