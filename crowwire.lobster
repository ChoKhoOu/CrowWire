name: crowwire-news-monitor
args:
  config:
    default: "/opt/crowwire/feeds.yaml"
  db:
    default: "/opt/crowwire/crowwire.db"
  channel:
    default: "discord"
  target:
    default: "channel:YOUR_CHANNEL_ID"
steps:
  - id: fetch
    command: crowwire-cli fetch --config ${config}

  - id: dedup
    command: crowwire-cli dedup --db ${db}
    stdin: $fetch.stdout

  - id: score
    command: crowwire-cli score
    stdin: $dedup.stdout

  - id: classify
    command: crowwire-cli classify --db ${db} --similarity-threshold 0.55 --sent-event-ttl 24
    stdin: $score.stdout

  - id: deliver-urgent
    command: crowwire-cli format --type urgent
    stdin: $classify.stdout

  - id: send-urgent
    command: crowwire-cli send --channel ${channel} --target ${target}
    stdin: $deliver-urgent.stdout

  - id: deliver-digest
    command: crowwire-cli format --type digest
    stdin: $classify.stdout

  - id: send-digest
    command: crowwire-cli send --channel ${channel} --target ${target}
    stdin: $deliver-digest.stdout
