// Auto-generated from Gimmick Requirements.txt
export type GimmickRequirementCheck =
  | { kind: "riskMin"; value: number; onlyIf?: string }
  | { kind: "gender"; value: string }
  | { kind: "ageMax"; value: number }
  | { kind: "ageMin"; value: number }
  | { kind: "nationality"; value: string }
  | { kind: "nationalityNot"; value: string }
  | { kind: "nationalityAny"; values: string[] }
  | { kind: "dispositionAny"; values: string[] }
  | { kind: "weight"; value: string }
  | { kind: "position"; value: string }
  | { kind: "statMin"; field: string; value: number }
  | { kind: "statMax"; field: string; value: number }
  | { kind: "flagTrue"; field: string }
  | { kind: "flagFalse"; field: string }
  | { kind: "nameEquals"; value: string };

export type GimmickRequirementRule = {
  id: number;
  name: string;
  requirements: GimmickRequirementCheck[];
  notes: string[];
  assignable: boolean;
  raw: string[];
};

export const GIMMICK_REQUIREMENT_RULES: GimmickRequirementRule[] = [
  {
    "id": 202,
    "name": "Adult Film Star",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 75
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 75% or higher"
    ]
  },
  {
    "id": 152,
    "name": "All-American",
    "requirements": [
      {
        "kind": "nationality",
        "value": "American"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be American"
    ]
  },
  {
    "id": 183,
    "name": "Angry Minority",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 81,
    "name": "Angry Young Man",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 20
      },
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "ageMax",
        "value": 28
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 20% or higher",
      "Gender must be Male",
      "Age must be 28 or less"
    ]
  },
  {
    "id": 46,
    "name": "Anti USA",
    "requirements": [
      {
        "kind": "nationalityNot",
        "value": "American"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must not be American"
    ]
  },
  {
    "id": 111,
    "name": "Arabian",
    "requirements": [
      {
        "kind": "nationality",
        "value": "Other"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be Other",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 73,
    "name": "Armed Forces",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 71,
    "name": "Arrogant",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 37,
    "name": "Authority Figure",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 4,
    "name": "Bad Ass",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 65,
    "name": "BFG",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      },
      {
        "kind": "weight",
        "value": "Heavyweight"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener",
      "Weight must be Heavyweight"
    ]
  },
  {
    "id": 197,
    "name": "Biker",
    "requirements": [
      {
        "kind": "weight",
        "value": "Heavyweight"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Weight must be Heavyweight"
    ]
  },
  {
    "id": 28,
    "name": "Bitch",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 30
      },
      {
        "kind": "gender",
        "value": "Female"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 30% or higher",
      "Gender must be Female"
    ]
  },
  {
    "id": 54,
    "name": "Blue Chipper",
    "requirements": [
      {
        "kind": "ageMax",
        "value": 27
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Age must be 27 or less"
    ]
  },
  {
    "id": 61,
    "name": "Blue Collar",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 80,
    "name": "Bodyguard",
    "requirements": [
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Must be Menacing"
    ]
  },
  {
    "id": 76,
    "name": "Bounty Hunter",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Must be Menacing"
    ]
  },
  {
    "id": 133,
    "name": "Boy Band",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "ageMax",
        "value": 25
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male",
      "Age must be 25 or less",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 113,
    "name": "Braveheart",
    "requirements": [
      {
        "kind": "nationality",
        "value": "British"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be British",
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 190,
    "name": "Bully",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Must be Menacing"
    ]
  },
  {
    "id": 193,
    "name": "Bum",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 104,
    "name": "Bumbling Englishman",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      },
      {
        "kind": "nationality",
        "value": "British"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener",
      "Nationality must be British"
    ]
  },
  {
    "id": 116,
    "name": "Censor",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 100,
    "name": "Chameleon",
    "requirements": [
      {
        "kind": "statMin",
        "field": "brawling",
        "value": 50
      },
      {
        "kind": "statMin",
        "field": "technical",
        "value": 50
      },
      {
        "kind": "statMin",
        "field": "speed",
        "value": 50
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Brawl must be 50 or higher",
      "Tech must be 50 or higher",
      "Speed must be 50 or higher"
    ]
  },
  {
    "id": 23,
    "name": "Cheater",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 63,
    "name": "Cheerleader",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female",
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 53,
    "name": "Chosen One",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 139,
    "name": "City Slicker",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 204,
    "name": "Clean Cut",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 176,
    "name": "Clown",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 85,
    "name": "Coach",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 2,
    "name": "Cocky",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 97,
    "name": "Comedian",
    "requirements": [
      {
        "kind": "statMin",
        "field": "charisma",
        "value": 75
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Charisma must be 75 or higher"
    ]
  },
  {
    "id": 19,
    "name": "Comedy Character",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 101,
    "name": "Comic Book Hero",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": -1,
    "name": "Comic Book Villain",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 194,
    "name": "Commissioner",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 110,
    "name": "Comrade",
    "requirements": [
      {
        "kind": "nationality",
        "value": "European"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be European",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 143,
    "name": "Conman",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 192,
    "name": "Convict",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Must be Menacing"
    ]
  },
  {
    "id": 16,
    "name": "Cool",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": -1,
    "name": "Corrupt Law Enforcer",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 40
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 40% or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 179,
    "name": "Country Singer",
    "requirements": [
      {
        "kind": "nationality",
        "value": "American"
      },
      {
        "kind": "statMin",
        "field": "charisma",
        "value": 60
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be American",
      "Charisma must be 60 or higher"
    ]
  },
  {
    "id": 3,
    "name": "Cowardly",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagFalse",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Dispostion must be Heel or Tweener",
      "Must not be Menacing"
    ]
  },
  {
    "id": 43,
    "name": "Cowboy",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "nationalityAny",
        "values": [
          "American",
          "Canadian"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male",
      "Nationality must be American or Canadian"
    ]
  },
  {
    "id": 18,
    "name": "Crazy",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 30
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 30% or higher"
    ]
  },
  {
    "id": 150,
    "name": "Cult Leader",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 50
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "statMin",
        "field": "charisma",
        "value": 75
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 50% or higher",
      "Disposition must be Heel or Tweener",
      "Charisma must be 75 or higher"
    ]
  },
  {
    "id": 125,
    "name": "Daddy's Girl",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": -1,
    "name": "Dancer",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      },
      {
        "kind": "flagTrue",
        "field": "diva"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female",
      "Must be Diva"
    ]
  },
  {
    "id": 10,
    "name": "Daredevil",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      },
      {
        "kind": "riskMin",
        "value": 60
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener",
      "Company Risk must be 60% or higher"
    ]
  },
  {
    "id": 94,
    "name": "Dealer",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 80
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 80% or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 36,
    "name": "Degenerate",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 65
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 65% or higher"
    ]
  },
  {
    "id": 120,
    "name": "Demon",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 40
      },
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 40% or higher",
      "Must be Menacing"
    ]
  },
  {
    "id": 92,
    "name": "Detective",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 153,
    "name": "Dual-Sport Superstar",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 20,
    "name": "Dude",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 15,
    "name": "Egomaniac",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 115,
    "name": "Enforcer",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 126,
    "name": "Equality Fighter",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female",
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 8,
    "name": "Evil",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "riskMin",
        "value": 20
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Company Risk must be 20% or higher"
    ]
  },
  {
    "id": 30,
    "name": "Evil Boss",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 177,
    "name": "Evil Clown",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 140,
    "name": "Evil Dentist",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 25,
    "name": "Evil Foreigner",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "nationalityNot",
        "value": "American"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Nationality must not be American"
    ]
  },
  {
    "id": 156,
    "name": "Evil Knight",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 138,
    "name": "Evil Pimp",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 70
      },
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 70% or higher",
      "Gender must be Male",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 103,
    "name": "Evil Preacher",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 40
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 40% or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 168,
    "name": "Evil Referee",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "weight",
        "value": "Lightweight"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Weight must be Lightweight"
    ]
  },
  {
    "id": 201,
    "name": "Evolution",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 84,
    "name": "Executive Consultant",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 58,
    "name": "Extremist",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 60
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 60% or higher"
    ]
  },
  {
    "id": 199,
    "name": "Family Guy",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 122,
    "name": "Fiery Italian",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 173,
    "name": "Fitness Instructor",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 128,
    "name": "Foreign Royalty",
    "requirements": [
      {
        "kind": "nationality",
        "value": "European"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be European",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 35,
    "name": "Foreign Star",
    "requirements": [
      {
        "kind": "nationalityNot",
        "value": "American"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must not be American"
    ]
  },
  {
    "id": 57,
    "name": "Franchise Player",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "position",
        "value": "Main Event"
      },
      {
        "kind": "flagTrue",
        "field": "superstarLook"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Position must be Main Event",
      "Must have Superstar Look"
    ]
  },
  {
    "id": 21,
    "name": "Freak",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 26,
    "name": "Fun Babyface",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 105,
    "name": "Fun Drunk",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 50
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 50% or higher",
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 17,
    "name": "Gangsta",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 60
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 60% or higher",
      "Disposition must be Heel or Tweener",
      "Must be Menacing"
    ]
  },
  {
    "id": 31,
    "name": "Gay",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 60,
        "onlyIf": "Face or Tweener"
      },
      {
        "kind": "riskMin",
        "value": 0,
        "onlyIf": "Heel"
      },
      {
        "kind": "flagFalse",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 60% or higher for Face or Tweener",
      "Company Risk of 0% or higher for Heel",
      "Must not be Menacing"
    ]
  },
  {
    "id": 75,
    "name": "Geek",
    "requirements": [
      {
        "kind": "flagFalse",
        "field": "superstarLook"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Must not have Superstar Look"
    ]
  },
  {
    "id": 89,
    "name": "Gender Bender",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 70
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 70% or higher"
    ]
  },
  {
    "id": 40,
    "name": "Genius",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 123,
    "name": "Girl Power",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female",
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 29,
    "name": "Girl-Next-Door",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female",
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 88,
    "name": "Glam Rocker",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 62,
    "name": "Gothic",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 172,
    "name": "Grizzled Veteran",
    "requirements": [
      {
        "kind": "ageMin",
        "value": 36
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Age must be 36 or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 91,
    "name": "Grunge",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 165,
    "name": "Guru",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "statMin",
        "field": "charisma",
        "value": 80
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Charisma must be 80 or higher"
    ]
  },
  {
    "id": 130,
    "name": "Harsh German",
    "requirements": [
      {
        "kind": "nationality",
        "value": "European"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be European",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 5,
    "name": "Hero",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 13,
    "name": "High Society",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 118,
    "name": "Highlight Reel",
    "requirements": [
      {
        "kind": "statMin",
        "field": "speed",
        "value": 75
      },
      {
        "kind": "flagTrue",
        "field": "highSpots"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Speed must be 75 or higher",
      "Must have High Spots"
    ]
  },
  {
    "id": 167,
    "name": "Hillbilly",
    "requirements": [
      {
        "kind": "nationality",
        "value": "American"
      },
      {
        "kind": "gender",
        "value": "Male"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be American",
      "Gender must be Male"
    ]
  },
  {
    "id": 70,
    "name": "Hired Gun",
    "requirements": [
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Must be Menacing"
    ]
  },
  {
    "id": 189,
    "name": "Ice Man",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": -1,
    "name": "Impressionist",
    "requirements": [
      {
        "kind": "statMin",
        "field": "charisma",
        "value": 75
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Charisma must be 75 or higher"
    ]
  },
  {
    "id": 146,
    "name": "Informer",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 50,
    "name": "Inspirational Leader",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face"
        ]
      },
      {
        "kind": "statMin",
        "field": "charisma",
        "value": 75
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face",
      "Charisma of 75 or more"
    ]
  },
  {
    "id": 96,
    "name": "Journalist",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 93,
    "name": "Junkie",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 70
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 70% or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 155,
    "name": "Knight",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male",
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 41,
    "name": "Lackey",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 134,
    "name": "Law Enforcer",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 142,
    "name": "Lawyer",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 9,
    "name": "Legitimate Athlete",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 39,
    "name": "Loner",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 196,
    "name": "Luchadore",
    "requirements": [
      {
        "kind": "weight",
        "value": "Lightweight"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Weight must be Lightweight"
    ]
  },
  {
    "id": 107,
    "name": "Lumberjack",
    "requirements": [
      {
        "kind": "nationalityAny",
        "values": [
          "American",
          "Canadian"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be American or Canadian"
    ]
  },
  {
    "id": 119,
    "name": "Machine",
    "requirements": [
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Must be Menacing"
    ]
  },
  {
    "id": 144,
    "name": "Mafia",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 60
      },
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 60% or higher",
      "Gender must be Male",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 132,
    "name": "Magician",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 182,
    "name": "Man Beast",
    "requirements": [
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Must be Menacing"
    ]
  },
  {
    "id": -1,
    "name": "Man In Black",
    "requirements": [
      {
        "kind": "flagTrue",
        "field": "superstarLook"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Must have Superstar Look"
    ]
  },
  {
    "id": -1,
    "name": "Man On A Mission",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male"
    ]
  },
  {
    "id": 154,
    "name": "Manic Depressive",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 79,
    "name": "Martial Arts",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 141,
    "name": "Masochist",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 80
      },
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 80% or higher",
      "Gender must be Male",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 77,
    "name": "Mentor",
    "requirements": [
      {
        "kind": "ageMin",
        "value": 40
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Age of 40 or higher"
    ]
  },
  {
    "id": 90,
    "name": "Metalhead",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 25
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 25% or higher"
    ]
  },
  {
    "id": 127,
    "name": "Misogynist",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 70
      },
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 70% or higher",
      "Gender must be Male",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 24,
    "name": "Monster",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 20
      },
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 20% or higher",
      "Must be Menacing"
    ]
  },
  {
    "id": 198,
    "name": "Mountie",
    "requirements": [
      {
        "kind": "nationalityNot",
        "value": "Canadian"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must not be Canadian"
    ]
  },
  {
    "id": 114,
    "name": "Movie Star",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagTrue",
        "field": "superstarLook"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Must have Superstar Look"
    ]
  },
  {
    "id": 7,
    "name": "Mysterious",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 51,
    "name": "Native American",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      },
      {
        "kind": "nationality",
        "value": "American"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener",
      "Nationality must be American"
    ]
  },
  {
    "id": 200,
    "name": "Nerd",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 78,
    "name": "Ninja",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 42,
    "name": "No Gimmick Needed",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 0,
    "name": "None",
    "requirements": [
      {
        "kind": "statMax",
        "field": "overness",
        "value": 70
      }
    ],
    "notes": [],
    "assignable": false,
    "raw": [
      "Overness of 70 or less"
    ]
  },
  {
    "id": 22,
    "name": "Obnoxious",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 185,
    "name": "Obsessed Fan",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 67,
    "name": "Occult",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 70
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagTrue",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 70% or higher",
      "Disposition must be Heel or Tweener",
      "Must be Menacing"
    ]
  },
  {
    "id": 60,
    "name": "Old School Face",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 59,
    "name": "Old School Heel",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 109,
    "name": "Outbacker",
    "requirements": [
      {
        "kind": "nationality",
        "value": "Australian"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be Australian"
    ]
  },
  {
    "id": 98,
    "name": "Pacifist",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 191,
    "name": "Paper Boy",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 195,
    "name": "People's Boss",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 137,
    "name": "Pimp",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 70
      },
      {
        "kind": "gender",
        "value": "Male"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 70% or higher",
      "Gender must be Male"
    ]
  },
  {
    "id": 186,
    "name": "Pirate",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 175,
    "name": "Postal Worker",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 55,
    "name": "Power and Paint",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      },
      {
        "kind": "weight",
        "value": "Heavyweight"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener",
      "Weight must be Heavyweight"
    ]
  },
  {
    "id": 161,
    "name": "Pretentious Artist",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 11,
    "name": "Prima Donna",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagFalse",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Must not be Menacing"
    ]
  },
  {
    "id": 45,
    "name": "Pro USA",
    "requirements": [
      {
        "kind": "nationality",
        "value": "American"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Nationality must be American"
    ]
  },
  {
    "id": 6,
    "name": "Psycho",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 40
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 40% or higher"
    ]
  },
  {
    "id": 56,
    "name": "Punk",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 30
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 30% or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 68,
    "name": "Putz",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 151,
    "name": "Pyromaniac",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 70
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 70% or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 148,
    "name": "Racist",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 80
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "statMin",
        "field": "charisma",
        "value": 75
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 80% or higher",
      "Disposition must be Heel or Tweener",
      "Charisma must be 75 or higher"
    ]
  },
  {
    "id": 69,
    "name": "Rapper",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 30
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 30% or higher"
    ]
  },
  {
    "id": 147,
    "name": "Rasta",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male"
    ]
  },
  {
    "id": 72,
    "name": "Ravishing",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagTrue",
        "field": "superstarLook"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Must have Superstar Look"
    ]
  },
  {
    "id": 82,
    "name": "Rebel",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 44,
    "name": "Redneck",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "nationality",
        "value": "American"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male",
      "Nationality must be American"
    ]
  },
  {
    "id": 149,
    "name": "Religious Zealot",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 80
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 80% or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 49,
    "name": "Rich Snob",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "flagFalse",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Must not be Menacing"
    ]
  },
  {
    "id": 188,
    "name": "Rock Star",
    "requirements": [
      {
        "kind": "statMin",
        "field": "charisma",
        "value": 80
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Charisma must be 80 or higher"
    ]
  },
  {
    "id": 129,
    "name": "Royalty",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 1,
    "name": "Savage",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 163,
    "name": "Secretary",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female"
    ]
  },
  {
    "id": 27,
    "name": "Seductress",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 50
      },
      {
        "kind": "gender",
        "value": "Female"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 50% or higher",
      "Gender must be Female"
    ]
  },
  {
    "id": 169,
    "name": "Servant",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "statMax",
        "field": "overness",
        "value": 60
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Overness must be 60 or less"
    ]
  },
  {
    "id": 203,
    "name": "Shark Boy",
    "requirements": [
      {
        "kind": "nameEquals",
        "value": "Shark Boy"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Name must be Shark Boy"
    ]
  },
  {
    "id": 187,
    "name": "Sheik",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 181,
    "name": "Show Stealer",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      },
      {
        "kind": "statMin",
        "field": "speed",
        "value": 80
      },
      {
        "kind": "flagTrue",
        "field": "highSpots"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener",
      "Speed must be 80 or higher",
      "Must have High Spots"
    ]
  },
  {
    "id": 112,
    "name": "Sidekick",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 52,
    "name": "Slob",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 48,
    "name": "Slut",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 65
      },
      {
        "kind": "gender",
        "value": "Female"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 65% or higher",
      "Gender must be Female"
    ]
  },
  {
    "id": 117,
    "name": "Split Personality",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 159,
    "name": "Sports Agent",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 164,
    "name": "Staff Member",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 108,
    "name": "Stoner",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 60
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 60% or higher"
    ]
  },
  {
    "id": 178,
    "name": "Streaker",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 75,
        "onlyIf": "Males"
      },
      {
        "kind": "riskMin",
        "value": 95,
        "onlyIf": "Females"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 75% or higher for Males",
      "Company Risk must be 95% or higher for Females"
    ]
  },
  {
    "id": 157,
    "name": "Street Fighter",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 50
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 50% or higher"
    ]
  },
  {
    "id": 32,
    "name": "Suave",
    "requirements": [
      {
        "kind": "flagFalse",
        "field": "menacing"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Must not be Menacing"
    ]
  },
  {
    "id": 166,
    "name": "Sucka",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male"
    ]
  },
  {
    "id": 158,
    "name": "Sumo",
    "requirements": [
      {
        "kind": "position",
        "value": "Manager"
      },
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "weight",
        "value": "Heavyweight"
      },
      {
        "kind": "nationality",
        "value": "Japanese"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Position must be Manager",
      "Gender must be Male",
      "Weight must be Heavyweight",
      "Nationality must be Japanese"
    ]
  },
  {
    "id": 74,
    "name": "Supernatural",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 12,
    "name": "Teen Idol",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener"
    ]
  },
  {
    "id": 170,
    "name": "That 70's Guy",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male"
    ]
  },
  {
    "id": 171,
    "name": "That 80's Guy",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 86,
    "name": "The Brain",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 160,
    "name": "The Ryland Effect",
    "requirements": [
      {
        "kind": "gender",
        "value": "Male"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      },
      {
        "kind": "statMin",
        "field": "charisma",
        "value": 80
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Male",
      "Disposition must be Face or Tweener",
      "Charisma must be 80 or higher"
    ]
  },
  {
    "id": -1,
    "name": "Thief",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 33,
    "name": "Tomboy",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female"
    ]
  },
  {
    "id": 64,
    "name": "Trash",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 145,
    "name": "Triad",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 60
      },
      {
        "kind": "nationality",
        "value": "Japanese"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 60% or higher",
      "Nationality must be Japanese",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 34,
    "name": "Troublemaker",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 14,
    "name": "Underdog",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Face",
          "Tweener"
        ]
      },
      {
        "kind": "weight",
        "value": "Lightweight"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Face or Tweener",
      "Weight must be Lightweight"
    ]
  },
  {
    "id": 47,
    "name": "Underworld",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 65
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk of 65% or higher"
    ]
  },
  {
    "id": 66,
    "name": "Unique",
    "requirements": [],
    "notes": [
      "Cannot be directly assigned in the editor; this gimmick naturally occurs from a 100% segment."
    ],
    "assignable": false,
    "raw": [
      "Must be involved in a 100% segment"
    ]
  },
  {
    "id": 99,
    "name": "Unlucky",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 124,
    "name": "Valley Girl",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female"
    ]
  },
  {
    "id": 184,
    "name": "Vampire",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 60
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 60% or higher"
    ]
  },
  {
    "id": 106,
    "name": "Violent Drunk",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 70
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 70% or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 136,
    "name": "Voodoo",
    "requirements": [
      {
        "kind": "riskMin",
        "value": 60
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Company Risk must be 60% or higher",
      "Disposition must be Heel or Tweener"
    ]
  },
  {
    "id": 38,
    "name": "Weirdo",
    "requirements": [],
    "notes": [],
    "assignable": true,
    "raw": [
      "None"
    ]
  },
  {
    "id": 174,
    "name": "White Witch",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female"
    ]
  },
  {
    "id": 180,
    "name": "Whole Damn Show",
    "requirements": [
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      },
      {
        "kind": "statMin",
        "field": "speed",
        "value": 80
      },
      {
        "kind": "flagTrue",
        "field": "highSpots"
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Disposition must be Heel or Tweener",
      "Speed must be 80 or higher",
      "Must have High Spots"
    ]
  },
  {
    "id": 131,
    "name": "Witch",
    "requirements": [
      {
        "kind": "gender",
        "value": "Female"
      },
      {
        "kind": "dispositionAny",
        "values": [
          "Heel",
          "Tweener"
        ]
      }
    ],
    "notes": [],
    "assignable": true,
    "raw": [
      "Gender must be Female",
      "Disposition must be Heel or Tweener"
    ]
  }
] as any;
