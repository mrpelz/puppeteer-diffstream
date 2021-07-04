#!/bin/bash

ssh root@hermes.net.wurstsalat.cloud << EOF
  cd /opt/puppeteer-diffstream/
  scripts/pull-restart-watch.sh
EOF
