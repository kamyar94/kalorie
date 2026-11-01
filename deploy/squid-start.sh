#!/bin/sh
# Starts the egress proxy (docker-compose.yml runs this as the container's entry point).
#
# The image has no mkdir, sed or tr, only the shell's own commands, so this stays plain sh: it
# writes the site-dependent part of the allowlist to the memory folder /run/squid-allow (a tmpfs
# mount) and then replaces itself with Squid. The values come from site.env:
#   MEALIE_BASE_URL, OPENGYM_BASE_URL, OFF_BASE_URL   only the host name is used
#   PUSH_SERVICE_HOSTS, EGRESS_EXTRA_HOSTS            comma separated host names
# Anything that is not a plain host name (letters, digits, dots, hyphens) is skipped and reported.
set -eu

list=/run/squid-allow/site-hosts.txt
printf '%s\n' '# Written by squid-start.sh from site.env when the container started.' > "$list"

add() {
  case "$1" in
    "" | *[!A-Za-z0-9.-]* | -* | *..*)
      echo "squid-start: skipped '$1' (not a plain host name)" >&2
      return 0
      ;;
  esac
  printf '%s\n' "$1" >> "$list"
  echo "squid-start: allowing $1"
}

# The host of an http(s) URL: no scheme, credentials, port, path or query.
host_of() {
  url=${1#*://}
  url=${url%%/*}
  url=${url%%\?*}
  url=${url##*@}
  printf '%s' "${url%%:*}"
}

for name in MEALIE_BASE_URL OPENGYM_BASE_URL OFF_BASE_URL; do
  eval "value=\${$name:-}"
  [ -n "$value" ] && add "$(host_of "$value")"
done

old_ifs=$IFS
IFS=,
for host in ${PUSH_SERVICE_HOSTS:-} ${EGRESS_EXTRA_HOSTS:-}; do
  host=${host# }
  host=${host% }
  [ -n "$host" ] && add "$host"
done
IFS=$old_ifs

exec /usr/sbin/squid-gnutls -f /etc/squid/squid.conf -NYC
