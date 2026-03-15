
http://justavps.com/
- SSH
- Full PORT PROXY
- PASSWORD-PROTECT
- SHAREABLE PROXIES BY DEFAULT
- SECURITY, SSH, AS ONLY CONCERN
- 1 CLICK INSTALL TEMPLATES / INSTALL UR OWN STUFF / CREATE SNAPSHOTS TO SHARE 


IT SHOULD JUST BE a VPS PROVIDER / provisioner with a FANCY UI / we under the hood can have Hetzner, OVH, Contabo, all of these different Providers -> just have their VPS, buy them, provision them. & then only thing we have by default is a SNAPSHOT with like these extra stuff I just said

- https://www.daytona.io/docs/en/ssh-access/

- Build from DOCKER IMAGE

“”””It will be interesting to see the progression of stateless vs temp sandbox vs dedicated VMs for AI software.

OpenClaw is the first 'great' dedicated VM tool.  I suspect dedicated VM products will massively outperform their shared or temporary counterparts.

Year of AI employees




Marko Kraemer

￼
@markokraemer
·
4h
Agree. interesting and obvious shift from burst AI compute, short lived sandboxes to fully 24/7 always running sandboxes/computers. 

Massive biz to build a infra wrapper around just pure VPS (not microVMs e2b, daytona & co style) but literally just a secure VPS with great DX for agents




Vasek Mlejnsky

￼
@mlejva
·
2h
the future ai world computer that we're building is a system. It can smartly decide what kind of infra it needs to run a specific workload. Some times it's a full regular vm-like machine, sometimes it's a microvm, sometimes it's maybe something extremely lightweight closer to a cloud function.

This problem can't be solved with a single type of a workload. No one really has an answer to this so far




Marko Kraemer

￼
@markokraemer
·
53m
I fully agree with this, but my thought here is more simple – for the central OS -> u will have agents working 24/7, outputting tokens 24/7, running on triggers & heartbeats. Having their home on e2b, daytona, modal sandbox is significantly more expensive today then running it on a VPS, without a question there is a lot of security & dx benefits but my take here is that either u guys or someone else should bring those dx&security benefits just to a premium VPS service at a fraction of the cost, because u will need that main OS compute to run 24/7






Vasek Mlejnsky

￼
@mlejva
The way we think about it is that our incentive is to make sbxs as cheap as possible over time. 
Already testing new pricing with a few customers!
10:17 PM · Mar 15, 2026
·
22
 Views




it should be 1 CLICK —> boom VPS. here ssh key to get u started. Also can have templates to select so u can get ur OpenClaw / OpenCode Server / Claude Code / Kortix 

Like most fucking normal get ur wordpress experience xD



Marko Kraemer

￼
@markokraemer
·
40m
How cheap / close can u get u believe? Btw personally it doesnt have to be Hetzner prices ofc, but obv it needs to be economical to run a sandbox 24/7
“”””

[15.03.26, 19:21:34] M: why dont u just do this btw
[15.03.26, 19:21:54] M: like what we are doing rn
[15.03.26, 19:26:40] M: Can I hire u to do it for us / maintain it, we  productise it as well as standalone service Would run our full cloud on it.

Problem with daytona, e2b & the others for 24/7 long running agents is that its just to costly
[15.03.26, 19:27:17] M: Also I think even for ppl developing yk! like u want an ALWAYS ON VPS, like u want ur claude code / opencode whatever running on a VPS that u get 1 click & boom SSH into and just setup everything on there. Ur agents & processes just run
[15.03.26, 19:28:32] M: Btw can u remember when we first talked about agent sandboxes - THERE WAS NOTHING. Not a single company doing it, hah when I was doing my shitty risky af sg-dev-envs
[15.03.26, 19:29:02] M: we ended up being daytona first customer. they pivoted with us


