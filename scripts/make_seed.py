"""Generates data/seed.json from the approved seed design (SEED_DESIGN.md). Run: python3 scripts/make_seed.py"""
import json
reps = [
 dict(id="maya", name="Maya Cohen", role="Sales Lead", homeBase="Tel Aviv", focus="All segments", regions="Global"),
 dict(id="daniel", name="Daniel Brooks", role="Account Executive", homeBase="London", focus="Payment providers, cross-border", regions="Europe"),
 dict(id="noa", name="Noa Shapiro", role="Account Executive", homeBase="Tel Aviv", focus="Travel", regions="Europe, Middle East, APAC"),
 dict(id="jordan", name="Jordan Ellis", role="Account Executive", homeBase="New York", focus="Payment providers, treasury", regions="North America"),
 dict(id="lukas", name="Lukas Weber", role="Account Executive", homeBase="Berlin", focus="Treasury, marketplaces & platforms", regions="Europe"),
 dict(id="sofia", name="Sofia Marín", role="Business Development Rep", homeBase="Barcelona", focus="All segments (first meetings)", regions="Europe"),
]
owners = {"money2020-usa":"jordan","iata-wfs":"noa","afp":"jordan","fintech-meetup":"jordan","mpe":"daniel",
          "money2020-europe":"daniel","sibos":"maya","eurofinance":"lukas"}
C = [  # id, name, company, title, email
 ("dana","Dana Levi","Quellan Payments","Head of Partnerships","dana.levi@quellanpay.example"),
 ("tom","Tom Becker","Arvelo Pay","Head of Product","tom.becker@arvelopay.example"),
 ("priya","Priya Nair","Pellwood Beds","Director of Finance","priya.nair@pellwoodbeds.example"),
 ("oliver","Oliver Grant","Oriel Travel Exchange","Chief Commercial Officer","oliver.grant@orieltravel.example"),
 ("chris","Chris Adeyemi","Sankomo Remit","Head of Payments","chris.adeyemi@sankomoremit.example"),
 ("hannah","Hannah Morales","Stallwise","Treasury Manager",None),
 ("ryan","Ryan Clarke","Recontix","Sales Director",None),
 ("marco","Marco Rossi","Crateline","Head of Finance","marco.rossi@crateline.example"),
 ("nadia","Nadia Haddad","Crateline","Payments Operations Lead","payments@crateline.example"),
 ("alex","Alexander Novak","Kvetta Pay","Head of Payments",None),
 ("david","David Katz","Iberanta Tours","Revenue Manager",None),
 ("sven","Sven Larsen","Nordvik Air","Treasury Director",None),
 ("emma","Emma Walsh","Ledgerline","Finance Director",None),
 ("grace","Grace Liu","Solvenza Travel","Finance Director",None),
 ("johanna","Johanna Berg","Halvard Industries","Assistant Treasurer","johanna.berg@halvard.example"),
]
exports = {"tom": {"date":"2026-06-10","encounterCount":3}, "priya": {"date":"2026-03-10","encounterCount":1}}
def ns(text, status, statusDate=None, due=None, statusNote=None):
    return dict(text=text, due=due, status=status, statusDate=statusDate, statusNote=statusNote)
# id, contact, conferenceId, edition, date, rep, outcome, nextStep, note
E = [
 ("e01","dana","mpe","2026","2026-03-18","sofia","Interested",None,"Runs partnerships at Quellan. Their merchants in Poland and Czechia want to charge in local currency, but Quellan doesn't want to carry the FX risk. Asked for a one-pager on rate lock."),
 ("e02","dana","money2020-europe","2026","2026-06-03","daniel","Next step agreed",ns("Intro call with Quellan's payments team","Done","2026-06-18"),"Read the one-pager. Wants to test rate lock on PLN and CZK checkout with 2–3 large merchants. The share of the rate-lock fee is what got her CFO's attention."),
 ("e03","tom","money2020-europe","2025","2025-06-04","daniel","Interested",None,"Curious about rate lock for their e-commerce merchants. \"Send me something.\" No use case or timeline."),
 ("e04","tom","money2020-usa","2025","2025-10-28","jordan","Interested",None,"Came by the stand again. General pricing questions; says FX isn't on this year's roadmap."),
 ("e05","tom","money2020-europe","2026","2026-06-04","sofia","Interested",None,"Friendly, same conversation as last year. Asked for the deck again; didn't want to set a call. \"Maybe after summer.\""),
 ("e06","priya","itb-berlin","2026","2026-03-04","noa","Next step agreed",ns("Call with Pellwood's CFO to scope hedging on hotel contracts","Didn't happen","2026-04-15",statusNote="CFO call cancelled twice; no reply since."),"Pellwood pays hotels in EUR, THB and AED but sells to agencies in GBP and USD. Margin moves with the currency between booking and stay. Wants her CFO on a call."),
 ("e07","priya","eurofinance","2026","2026-09-17","lukas","Interested",None,"Still interested in principle, but this year's budget went to their new booking engine. Suggested we check back in Q1."),
 ("e08","oliver","phocuswright","2025","2025-11-19","noa","Interested",None,"Oriel sells hotel inventory to agencies in 30+ countries, priced in local currency. Wants to offer agencies optional rate protection; liked the idea of sharing the premium."),
 ("e09","oliver","itb-berlin","2026","2026-03-05","noa","Next step agreed",ns("Demo for Oriel's CFO and head of product","Done","2026-05-20"),"Brought his head of product to the stand. Agencies in Brazil and Turkey are the pain point. Demo after their Q2 release."),
 ("e10","chris","money2020-usa","2026","2026-10-18","jordan","Next step agreed",ns("CFO call","Open",due="2026-10-27"),"Sankomo sends USD to NGN, GHS and KES. FX moves between quote and payout eat their margin. The CFO owns the decision; call set for Tue 27 Oct."),
 ("e11","hannah","money2020-usa","2026","2026-10-19","jordan","Interested",None,"B2B marketplace for restaurant supplies: US sellers, Mexican buyers. Pays sellers weekly; buyers pay in MXN. Interested; the CFO decides. No card."),
 ("e12","ryan","money2020-usa","2026","2026-10-19","maya","No clear intent",None,"Vendor pitching us reconciliation software. Not a prospect."),
 ("e13","marco","money2020-europe","2025","2025-06-04","daniel","Interested",None,"Crateline pays sellers in 20 countries; their bank does the FX at a spread. Interested but \"not a priority this year\"."),
 ("e14","marco","mpe","2026","2026-03-18","sofia","Interested",None,"Same position. General questions about seller payouts; no timeline."),
 ("e15","marco","eurofinance","2026","2026-09-17","lukas","Interested",None,"A new CFO started in July. Marco says FX cost on seller payouts is now a board topic, and budget for a solution is approved for Q1 2027. He'll send an RFP in November and wants us on the shortlist."),
 ("e16","nadia","money2020-europe","2026","2026-06-03","daniel","Interested",None,"Runs seller payouts at Crateline. Gave the team inbox, not her own. Budget decisions sit with Marco."),
 ("e17","alex","mpe","2026","2026-03-19","daniel","Interested",None,"BNPL with instalments in CZK, PLN and HUF; merchants settle in EUR. Currency moves between purchase and the last instalment hit their margin. Planning a US launch; will be at Money20/20 USA in October."),
 ("e18","david","itb-berlin","2026","2026-03-04","noa","Interested",None,"Tour operator selling Spain packages to UK and US agencies. Interested in locking GBP and USD rates at booking."),
 ("e19","sven","iata-wfs","2025","2025-11-05","noa","Interested",None,"Regional airline selling in NOK, SEK, EUR and GBP. Hedges fuel, not ticket revenue. Asked how cancellations and refunds would be handled."),
 ("e20","sven","itb-berlin","2026","2026-03-05","noa","Interested",None,"Asked for a case study. Said the Q2 planning cycle would decide."),
 ("e21","emma","money2020-usa","2025","2025-10-27","jordan","Interested",None,""),
 ("e22","emma","money2020-europe","2026","2026-06-02","sofia","Interested",None,""),
 ("e23","grace","phocuswright","2025","2025-11-20","noa","Interested",None,"OTA selling in 9 currencies across Asia-Pacific. Interested in showing rate protection at checkout; wants to revisit after their re-platforming in 2026."),
 ("e24","johanna","eurofinance","2026","2026-09-17","lukas","Next step agreed",ns("Send indicative hedging-programme pricing to Halvard's treasurer","Open"),"Manufacturer invoicing in 12 currencies; hedges quarterly with two banks. Asked for indicative pricing for their treasurer. We owe them this."),
]
# Past editions referenced by seeded encounters (the CSV holds upcoming editions only). Sources: CONFERENCE_RESEARCH.md §7.
past = [
 dict(conferenceId="money2020-europe", edition="2025", start="2025-06-03", end="2025-06-05", city="Amsterdam"),
 dict(conferenceId="money2020-usa", edition="2025", start="2025-10-26", end="2025-10-29", city="Las Vegas"),
 dict(conferenceId="iata-wfs", edition="2025", start="2025-11-05", end="2025-11-06", city="Istanbul"),
 dict(conferenceId="phocuswright", edition="2025", start="2025-11-18", end="2025-11-20", city="San Diego"),
 dict(conferenceId="itb-berlin", edition="2026", start="2026-03-03", end="2026-03-05", city="Berlin"),
 dict(conferenceId="mpe", edition="2026", start="2026-03-17", end="2026-03-19", city="Berlin"),
 dict(conferenceId="money2020-europe", edition="2026", start="2026-06-02", end="2026-06-04", city="Amsterdam"),
 dict(conferenceId="eurofinance", edition="2026", start="2026-09-16", end="2026-09-18", city="Barcelona"),
]
enc_company = {}  # company/title at the time of each encounter = contact's company (no seeded job changes)
contacts=[]
for cid,name,co,title,email in C:
    contacts.append(dict(id=cid,name=name,company=co,title=title,email=email,history=[],override=None,
                         export=exports.get(cid),aiAction=None))
cmap={c["id"]:c for c in contacts}
encounters=[]
eds={(p["conferenceId"],p["edition"]):p for p in past}
for eid,cid,conf,ed,date,rep,out,nstep,note in E:
    if (conf,ed) in eds:
        p=eds[(conf,ed)]; assert p["start"]<=date<=p["end"], eid
    else:
        assert (conf,ed)==("money2020-usa","2026") and "2026-10-18"<=date<="2026-10-19", eid  # C6 simulated present
    encounters.append(dict(id=eid,contactId=cid,conferenceId=conf,edition=ed,date=date,rep=rep,outcome=out,
                           nextStep=nstep,note=note,company=cmap[cid]["company"],title=cmap[cid]["title"]))
seed=dict(version=1, demoDate="2026-10-19", defaultUser="jordan",
          note="All people and companies are fictional. Emails use the reserved .example domain.",
          reps=reps, owners=owners, pastEditions=past, contacts=contacts, encounters=encounters)
json.dump(seed, open("data/seed.json","w",encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(contacts),"contacts,",len(encounters),"encounters")
