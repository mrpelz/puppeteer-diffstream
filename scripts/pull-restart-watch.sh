#!/bin/bash

git pull --rebase

/bin/systemctl restart puppeteer-diffstream.service
echo "restart done"

/bin/journalctl -u puppeteer-diffstream.service -fp notice
