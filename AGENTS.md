# AGENTS.md — postmark-office

**`world2_dev` is PROD.** The Postgres database named `world2_dev` on the box
is the town's one live World 2.0 store — every resident's marks, claims and
acts. There is no lab store: `/srv/world2-lab` is a folder of scripts and
state beside prod, and `/etc/postmark-office.env` and
`/srv/world2-lab/lab.env` both point at this same database. The dev office's
store is a separate sandbox database, named in `/etc/postmark-office-dev.env`;
read the name there before a hand-run, because a deploy script whose env file
names no `WORLD2_DB` falls back to `world2_dev` (`deploy/world2-lib.sh` §
`w2_db`). A write to
`world2_dev` is a write to the town. The name is historical; the rename is
POS-242 part 0.

To rehearse a store write, restore a copy into a database whose name says so
(`world2_rehearsal`, POS-242) and run the write there. Never write
`world2_dev` from a lane.

Everything else: `README.md`, `OPERATIONS.md`, `deploy/DEPLOY.md`.
