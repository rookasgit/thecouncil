import { RoleId } from './agents';

export interface TaskForceAgent {
  name: string;
  roleId: RoleId; // We need to map these to existing roles or create new ones? 
                  // The user request says "Agent objects (including their names and core frameworks)".
                  // It seems these are specific personas that might map to existing roles or be custom.
                  // Looking at agents.ts, we have roles like 'societal', 'cultural', etc. with specific thinkers.
                  // The user request specifies "Agent 1: Machiavelli", etc.
                  // I should probably map these to the existing structure or create a way to instantiate them.
                  // However, the user request says "3 pre-configured AI personas".
                  // I will define them as objects that can be used to override/configure the agents.
  coreFramework: string;
}

export interface TaskForce {
  id: string;
  name: string;
  purpose: string;
  agents: {
    name: string;
    coreFramework: string;
    // We might need to map to a roleId for color/icon purposes, or just use a generic one.
    // Let's assume we map them to the closest existing roles for visual consistency, 
    // or we can treat them as "Custom Agents" that are pre-defined.
    // Given the "Council Chamber" state uses `activeAgentIds`, and `ROLES` are fixed,
    // it's best to implement these as "Custom Agents" that get added to the conversation.
    roleId?: RoleId; 
  }[];
}

export const TASK_FORCES: TaskForce[] = [
  {
    id: 'career',
    name: 'CAREER (The War Room)',
    purpose: 'To navigate power dynamics, market value, and strategic leverage in professional settings.',
    agents: [
      {
        name: 'Machiavelli',
        coreFramework: 'Political Realism - Analyzes hidden power dynamics and self-interest.',
        roleId: 'societal'
      },
      {
        name: 'The Economist',
        coreFramework: 'Market Forces - Analyzes data, human capital, and supply/demand.',
        roleId: 'researcher'
      },
      {
        name: 'Milton Friedman',
        coreFramework: 'Free Market Individualism - Focuses on individual liberty and capital maximization.',
        roleId: 'cultural'
      }
    ]
  },
  {
    id: 'life',
    name: 'LIFE (The Meaning Crisis)',
    purpose: 'To resolve ethical dilemmas, existential dread, and value conflicts.',
    agents: [
      {
        name: 'Friedrich Nietzsche',
        coreFramework: 'Radical Skepticism/Will to Power - Pushes for self-overcoming, rejects herd morality.',
        roleId: 'societal'
      },
      {
        name: 'Jean-Paul Sartre',
        coreFramework: 'Existential Freedom - Focuses on radical choice and avoiding "bad faith".',
        roleId: 'cultural'
      },
      {
        name: 'Isaiah Berlin',
        coreFramework: 'Value Pluralism - Examines the tragic collision of equally valid human values/liberties.',
        roleId: 'researcher'
      }
    ]
  },
  {
    id: 'curiosity',
    name: 'CURIOSITY (The Lens Expanders)',
    purpose: 'To break down complex global events or technologies using extreme macro and structural perspectives.',
    agents: [
      {
        name: 'Carl Sagan',
        coreFramework: 'Cosmic Perspective - Scales the problem up to deep space/time and human survival.',
        roleId: 'futurist'
      },
      {
        name: 'Nick Bostrom',
        coreFramework: 'Existential Risk - Analyzes the topic through the lens of superintelligence and simulation/extinction risks.',
        roleId: 'tech'
      },
      {
        name: 'Adam Curtis',
        coreFramework: 'Power Structures - Looks for the hidden, unintended consequences of technocratic management.',
        roleId: 'societal'
      }
    ]
  },
  {
    id: 'product',
    name: 'PRODUCT (The Launch Pad)',
    purpose: 'To evaluate startup ideas, product-market fit, and future trajectories.',
    agents: [
      {
        name: 'Ray Kurzweil',
        coreFramework: 'Exponential Growth - Analyzes the product through the lens of accelerating technological curves.',
        roleId: 'futurist'
      },
      {
        name: 'Mark Fisher',
        coreFramework: 'Capitalist Realism - Critiques the cultural impact and consumerist psychology of the product.',
        roleId: 'cultural'
      },
      {
        name: 'The Economist',
        coreFramework: 'Data Analysis - Grounds the idea in ruthless market viability and unit economics.',
        roleId: 'researcher'
      }
    ]
  },
  {
    id: 'creative',
    name: 'CREATIVE (The Blank Page)',
    purpose: 'To shatter creative blocks using lateral thinking, ego removal, and absurdity.',
    agents: [
      {
        name: 'Brian Eno',
        coreFramework: 'Lateral Thinking - Uses "Oblique Strategies" and artificial constraints to force new patterns.',
        roleId: 'creative'
      },
      {
        name: 'John Cage',
        coreFramework: 'Chance Operations - Advocates for the complete removal of the artist\'s ego from the process.',
        roleId: 'creative'
      },
      {
        name: 'Werner Herzog',
        coreFramework: 'Ecstatic Truth - Searches for the bleak, poetic, and chaotic truth beneath the surface.',
        roleId: 'societal'
      }
    ]
  }
];
