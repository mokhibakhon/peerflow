/* ============================================================
   PeerFlow — the default twelve-week plan for each path.

   Not a curriculum. Every week names a thing to get through and,
   where one exists, somebody else's free material to get through
   it with. PeerFlow holds the order; roadmap.sh, PortSwigger,
   freeCodeCamp and the rest hold the lessons. That is deliberate:
   writing and maintaining eight IT syllabuses is a content team,
   and the material would be worse than what is already free.

   Weeks with no `src` are the ones where the work is yours —
   building the thing, writing it up, putting it somewhere public.
   They are in every plan on purpose, and they are the weeks that
   turn twelve weeks of study into something you can show.

   Keys match the track ids in signup.html and pf.trackNames.
   ============================================================ */
window.PF_PLANS = {

  frontend: [
    { t:'HTML and CSS that you actually understand', src:'MDN' },
    { t:'Flexbox and grid until layout stops fighting you', src:'CSS Tricks' },
    { t:'JavaScript: the language, not the framework', src:'javascript.info' },
    { t:'The DOM, events and fetch', src:'javascript.info' },
    { t:'Build one page with no framework at all' },
    { t:'React: components, props, state', src:'react.dev' },
    { t:'React: effects, and when not to use them', src:'react.dev' },
    { t:'Forms, validation and error states' },
    { t:'Fetching, loading and failing gracefully' },
    { t:'Accessibility: keyboard, contrast, labels', src:'web.dev' },
    { t:'Build a small app end to end' },
    { t:'Deploy it and write up what you learned' }
  ],

  backend: [
    { t:'How the web actually works: request to response', src:'MDN' },
    { t:'One language, properly: Node, Python or Go', src:'roadmap.sh' },
    { t:'HTTP, REST and what a good endpoint looks like' },
    { t:'Databases: tables, keys, relationships', src:'SQLBolt' },
    { t:'SQL you will use every day', src:'PostgreSQL Tutorial' },
    { t:'Build a CRUD API from nothing' },
    { t:'Authentication and sessions done properly', src:'OWASP' },
    { t:'Validation, errors and what to return when' },
    { t:'Testing: unit, then integration' },
    { t:'Caching, indexes and the first slow query' },
    { t:'Deploy the API somewhere real', src:'Fly.io docs' },
    { t:'Write up the design decisions you made' }
  ],

  cybersecurity: [
    { t:'What a network actually is', src:'roadmap.sh' },
    { t:'Ports, protocols and packets', src:'Julia Evans zines' },
    { t:'Set up a home lab', src:'TryHackMe' },
    { t:'Linux you will actually use', src:'OverTheWire' },
    { t:'Reading a packet capture', src:'Wireshark docs' },
    { t:'SQL injection, part one', src:'PortSwigger Academy' },
    { t:'SQL injection, part two', src:'PortSwigger Academy' },
    { t:'Authentication and sessions', src:'PortSwigger Academy' },
    { t:'Write up your first walkthrough' },
    { t:'Firewalls and network defence', src:'TryHackMe' },
    { t:'Pick a CTF and finish it', src:'picoCTF' },
    { t:'Put the three writeups somewhere public' }
  ],

  data: [
    { t:'Spreadsheets before anything else' },
    { t:'SQL: select, join, group', src:'SQLBolt' },
    { t:'SQL: window functions and the hard bits', src:'Mode SQL Tutorial' },
    { t:'Python and pandas', src:'Kaggle Learn' },
    { t:'Cleaning a genuinely messy dataset' },
    { t:'Charts that do not mislead', src:'Storytelling with Data' },
    { t:'Statistics you need and no more', src:'Seeing Theory' },
    { t:'Build a dashboard somebody could use' },
    { t:'A/B tests and why most of them are wrong' },
    { t:'Find a public dataset and ask it a question', src:'data.gov' },
    { t:'Write the analysis up as if for a manager' },
    { t:'Publish the notebook and the writeup' }
  ],

  mobile: [
    { t:'Pick a platform and stop second-guessing it', src:'roadmap.sh' },
    { t:'The language: Swift, Kotlin or Dart' },
    { t:'Layout and the widget or view tree' },
    { t:'Navigation between screens' },
    { t:'State, and where it should live' },
    { t:'Talking to an API from a phone' },
    { t:'Storing things on the device' },
    { t:'Build one screen you are proud of' },
    { t:'Permissions, camera, notifications' },
    { t:'Testing on a real device, not the simulator' },
    { t:'Build a small app end to end' },
    { t:'Ship it to TestFlight or an internal track' }
  ],

  devops: [
    { t:'Linux and the command line', src:'OverTheWire' },
    { t:'Git properly: branches, rebase, bisect', src:'Git Book' },
    { t:'Networking: DNS, TLS, load balancers', src:'Julia Evans zines' },
    { t:'Docker: images, layers, volumes', src:'Docker docs' },
    { t:'Containerise something you built' },
    { t:'CI: run the tests on every push', src:'GitHub Actions docs' },
    { t:'CD: get it deployed automatically' },
    { t:'Infrastructure as code', src:'Terraform tutorials' },
    { t:'Monitoring, logs and the first alert' },
    { t:'Kubernetes, only as far as you need it', src:'kubernetes.io' },
    { t:'Break something on purpose and fix it' },
    { t:'Write the runbook you wish you had' }
  ],

  aiml: [
    { t:'The maths you actually need', src:'3Blue1Brown' },
    { t:'Python, numpy and pandas', src:'Kaggle Learn' },
    { t:'What a model is, without the mysticism', src:"Andrew Ng's course" },
    { t:'Linear and logistic regression by hand' },
    { t:'Train, test, overfit, regularise' },
    { t:'Trees and ensembles', src:'scikit-learn docs' },
    { t:'Enter a Kaggle competition and place badly', src:'Kaggle' },
    { t:'Neural networks from scratch', src:'fast.ai' },
    { t:'Fine-tune something pre-trained', src:'Hugging Face' },
    { t:'Evaluation: the metric is the whole game' },
    { t:'Build a model into a small app' },
    { t:'Write up what it gets wrong and why' }
  ],

  design: [
    { t:'Layout, spacing and hierarchy', src:'Refactoring UI' },
    { t:'Type: one family, used well', src:'Practical Typography' },
    { t:'Colour, contrast and accessibility', src:'web.dev' },
    { t:'Learn one tool properly', src:'Figma docs' },
    { t:'Redraw an app you use every day' },
    { t:'Components, variants and a small system' },
    { t:'Prototyping and handoff' },
    { t:'Talk to five people who would use it' },
    { t:'Design something from a real brief' },
    { t:'Iterate on it after showing someone' },
    { t:'Build the case study, not just the screens' },
    { t:'Publish the case study somewhere public' }
  ]
};
