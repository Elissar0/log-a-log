#!/bin/sh
set -eu

# Migrations take an advisory lock, so this stays safe if the API is scaled later.
bun run migrate
exec bun run start
