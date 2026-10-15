// Generated from Foundry artifacts. Run abi:generate after contracts:build.
export const boundraExecutorAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'accountOwner',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'asset',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'liquid',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'timed',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'DEPOSIT',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'EXIT_BUFFER',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'WITHDRAW',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allocationCompleted',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'consumedActionIds',
    inputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'cumulativeDeposited',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deploymentChainId',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'executeDeposit',
    inputs: [
      {
        name: 'actionId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'version',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'nonce',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'deadline',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'target',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'executeWithdraw',
    inputs: [
      {
        name: 'actionId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'version',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'nonce',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'deadline',
        type: 'uint64',
        internalType: 'uint64',
      },
      {
        name: 'target',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'fund',
    inputs: [
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'liquidVault',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mandate',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct BoundraExecutor.Mandate',
        components: [
          {
            name: 'chainId',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'asset',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'operator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'beneficiary',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'expiresAt',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'allowedVaults',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'allowedActions',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'maxLockupSeconds',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'maxDepositPerAction',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'maxCumulativeDeposits',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'maxWithdrawPerAction',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'allocationTarget',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'mandateVersion',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nextActionNonce',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ownerWithdraw',
    inputs: [
      {
        name: 'target',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pause',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'paused',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'recoverIdle',
    inputs: [
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resume',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revoke',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revoked',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setMandate',
    inputs: [
      {
        name: 'next',
        type: 'tuple',
        internalType: 'struct BoundraExecutor.Mandate',
        components: [
          {
            name: 'chainId',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'asset',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'operator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'beneficiary',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'expiresAt',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'allowedVaults',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'allowedActions',
            type: 'uint8',
            internalType: 'uint8',
          },
          {
            name: 'maxLockupSeconds',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'maxDepositPerAction',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'maxCumulativeDeposits',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'maxWithdrawPerAction',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'allocationTarget',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'timedVault',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'ActionExecuted',
    inputs: [
      {
        name: 'actionId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'version',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'nonce',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'action',
        type: 'uint8',
        indexed: false,
        internalType: 'uint8',
      },
      {
        name: 'target',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Funded',
    inputs: [
      {
        name: 'owner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'MandateSet',
    inputs: [
      {
        name: 'version',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
      {
        name: 'mandateHash',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'operator',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OwnerRecovered',
    inputs: [
      {
        name: 'source',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Paused',
    inputs: [
      {
        name: 'version',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Resumed',
    inputs: [
      {
        name: 'version',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Revoked',
    inputs: [
      {
        name: 'version',
        type: 'uint256',
        indexed: true,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'ActionNotAllowed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'AllocationAlreadyCompleted',
    inputs: [],
  },
  {
    type: 'error',
    name: 'BudgetExceeded',
    inputs: [],
  },
  {
    type: 'error',
    name: 'DepositLimit',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ExpiryBeforeUnlock',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InactiveMandate',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidAmount',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidConfiguration',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidDeadline',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidMandate',
    inputs: [],
  },
  {
    type: 'error',
    name: 'LockupNotAllowed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'OpenPosition',
    inputs: [],
  },
  {
    type: 'error',
    name: 'OperatorOnly',
    inputs: [],
  },
  {
    type: 'error',
    name: 'OwnerOnly',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ReentrancyGuardReentrantCall',
    inputs: [],
  },
  {
    type: 'error',
    name: 'Replay',
    inputs: [],
  },
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'TargetNotAllowed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'UnsupportedToken',
    inputs: [],
  },
  {
    type: 'error',
    name: 'VaultDegraded',
    inputs: [],
  },
  {
    type: 'error',
    name: 'WithdrawalLimit',
    inputs: [],
  },
  {
    type: 'error',
    name: 'WrongChain',
    inputs: [],
  },
  {
    type: 'error',
    name: 'WrongNonce',
    inputs: [],
  },
  {
    type: 'error',
    name: 'WrongVersion',
    inputs: [],
  },
] as const;
