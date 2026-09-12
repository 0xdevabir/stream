#!/bin/sh
# Applies pending migrations before the API starts accepting traffic.
#
# The API is the only service that touches the schema, so it is the natural
# place to run this: no separate migration job to forget, and no window where
# a new binary is serving against an old schema. Set RUN_MIGRATIONS=0 when
# running multiple replicas, and migrate out-of-band instead.
set -e

if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  echo "api: applying database migrations"
  cd /app/packages/db
  ./node_modules/.bin/prisma migrate deploy
  cd /app
fi

exec "$@"
