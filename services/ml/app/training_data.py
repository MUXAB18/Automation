"""
Bootstrap training data for the search-intent model.

There is no labelled keyword data yet, so the first model is trained on examples generated from
phrase patterns that reliably signal each intent ("how to ...", "buy ... online", "... near me"),
filled with many different topics. It is a starting point, not the finish line: `app.train` also
accepts a CSV of real, human-corrected labels (keyword,intent) which is added to the generated set,
and the held-out TEST_SET below (different topics, hand-written) measures how well the model
generalises to topics it never saw.
"""

from __future__ import annotations

import random

INTENTS = ("informational", "commercial", "transactional", "navigational", "local")

TOPICS = [
    "freight forwarding", "customs brokerage", "dental implants", "running shoes", "crm software",
    "email marketing", "web hosting", "solar panels", "car insurance", "yoga classes",
    "project management tool", "home renovation", "tax accounting", "laptop", "coffee machine",
    "seo audit", "wedding photography", "mortgage", "kitchen cabinets", "pet food",
    "electric bike", "legal services", "roof repair", "online course", "payroll software",
    "warehouse storage", "air purifier", "hair salon", "mobile app development", "office chairs",
]
BRANDS = [
    "gmail", "facebook", "amazon", "shopify", "paypal", "linkedin", "dropbox", "slack", "zoom",
    "netflix", "spotify", "notion", "stripe", "canada post", "td bank", "walmart", "ikea",
]
CITIES = ["ottawa", "toronto", "vancouver", "montreal", "calgary", "halifax", "winnipeg", "edmonton"]

TEMPLATES: dict[str, list[str]] = {
    "informational": [
        "how to {t}", "what is {t}", "{t} explained", "why {t} matters", "{t} guide for beginners",
        "what does {t} mean", "{t} tutorial", "benefits of {t}", "{t} pros and cons",
        "how does {t} work", "{t} checklist", "learn about {t}", "{t} vs", "history of {t}",
        "{t} tips", "can you {t}", "{t} basics", "difference between {t} and",
    ],
    "commercial": [
        "best {t}", "top 10 {t}", "{t} reviews", "{t} comparison", "{t} alternatives",
        "best {t} for small business", "{t} ratings", "which {t} is best", "{t} vs competitors",
        "is {t} worth it", "{t} recommendations", "affordable {t} options", "{t} features compared",
        "{t} buyer's guide", "top rated {t}", "{t} review 2026",
    ],
    "transactional": [
        "buy {t}", "{t} price", "{t} quote", "order {t} online", "{t} for sale", "cheap {t}",
        "{t} discount code", "hire {t}", "get a {t} quote", "{t} pricing plans", "{t} free trial",
        "{t} coupon", "purchase {t}", "book {t}", "sign up for {t}", "{t} cost",
    ],
    "navigational": [
        "{b} login", "{b} sign in", "{b} official site", "{b} website", "{b} app download",
        "{b} customer service", "{b} contact", "{b} account", "{b} homepage", "{b}.com",
        "log in to {b}", "{b} support", "{b} careers", "{b} pricing page", "{b} dashboard",
    ],
    "local": [
        "{t} near me", "{t} in {c}", "{t} {c}", "best {t} in {c}", "{t} close to me",
        "{c} {t} open now", "local {t}", "{t} downtown {c}", "{t} around {c}", "{t} nearby",
        "{t} services in {c}", "{c} {t} company",
    ],
}


def generate(seed: int = 7) -> list[tuple[str, str]]:
    """Deterministic labelled examples built from the patterns above."""
    rng = random.Random(seed)
    rows: list[tuple[str, str]] = []
    for intent, templates in TEMPLATES.items():
        for template in templates:
            if "{b}" in template:
                for brand in BRANDS:
                    rows.append((template.format(b=brand), intent))
                continue
            for topic in TOPICS:
                city = rng.choice(CITIES)
                rows.append((template.format(t=topic, c=city), intent))
    return sorted(set(rows))


# Hand-written queries on topics that never appear in TOPICS/BRANDS: the honest measure of quality.
TEST_SET: list[tuple[str, str]] = [
    ("how to repot a monstera", "informational"), ("what is a heat pump", "informational"),
    ("guitar tuning explained", "informational"), ("why do cats purr", "informational"),
    ("beginner guide to sourdough", "informational"), ("how does a vpn work", "informational"),
    ("benefits of cold showers", "informational"), ("tent camping checklist", "informational"),
    ("what does apr mean", "informational"), ("basics of chess openings", "informational"),
    ("best noise cancelling headphones", "commercial"), ("top 10 hiking boots", "commercial"),
    ("standing desk reviews", "commercial"), ("vacuum cleaner comparison", "commercial"),
    ("best vpn for small business", "commercial"), ("trello alternatives", "commercial"),
    ("is a robot mower worth it", "commercial"), ("top rated blenders", "commercial"),
    ("which camera is best for travel", "commercial"), ("treadmill ratings", "commercial"),
    ("buy ergonomic keyboard", "transactional"), ("tent price", "transactional"),
    ("order flowers online", "transactional"), ("guitar lessons quote", "transactional"),
    ("hire a web designer", "transactional"), ("cheap suitcases", "transactional"),
    ("espresso machine coupon", "transactional"), ("book a dog groomer", "transactional"),
    ("sign up for meal delivery", "transactional"), ("drone for sale", "transactional"),
    ("trello login", "navigational"), ("airbnb official site", "navigational"),
    ("figma sign in", "navigational"), ("github dashboard", "navigational"),
    ("instagram app download", "navigational"), ("hubspot contact", "navigational"),
    ("log in to canva", "navigational"), ("uber support", "navigational"),
    ("etsy account", "navigational"), ("asana homepage", "navigational"),
    ("plumber near me", "local"), ("bakery in ottawa", "local"),
    ("physiotherapy toronto", "local"), ("best pizza in calgary", "local"),
    ("tire shop close to me", "local"), ("vancouver florist open now", "local"),
    ("locksmith nearby", "local"), ("daycare in halifax", "local"),
    ("local bike repair", "local"), ("dentist downtown montreal", "local"),
]
