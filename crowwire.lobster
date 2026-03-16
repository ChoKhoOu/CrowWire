name: crowwire-news-monitor
args:
  config:
    default: "/opt/crowwire/feeds.yaml"
  db:
    default: "/opt/crowwire/crowwire.db"
  channel:
    default: "news"
steps:
  - id: fetch
    command: crowwire-cli fetch --config $args.config

  - id: dedup
    command: crowwire-cli dedup --db $args.db
    stdin: $fetch.stdout

  - id: score
    command: crowwire-cli score
    stdin: $dedup.stdout

  - id: classify
    command: crowwire-cli classify --db $args.db --similarity-threshold 0.55 --sent-event-ttl 24
    stdin: $score.stdout

  - id: deliver-urgent
    command: crowwire-cli format --type urgent
    stdin: $classify.stdout
    condition: $classify.json.has_urgent

  - id: send-urgent
    command: openclaw.invoke --tool message --action send --args-json '{"channel": "$args.channel"}'
    stdin: $deliver-urgent.stdout
    condition: $classify.json.has_urgent

  - id: deliver-digest
    command: crowwire-cli format --type digest
    stdin: $classify.stdout
    condition: $classify.json.has_digest

  - id: send-digest
    command: openclaw.invoke --tool message --action send --args-json '{"channel": "$args.channel"}'
    stdin: $deliver-digest.stdout
    condition: $classify.json.has_digest
