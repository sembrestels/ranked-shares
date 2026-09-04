// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PB Expanding Approvals Rule (PB-EAR) engine
/// @notice Abstract on-chain implementation of Algorithm 1 from Aziz & Lee,
///         "Proportionally Representative Participatory Budgeting with Ordinal
///         Preferences" (AAAI-21), with the uniform fractional reweighting of
///         Aziz & Lee, "The expanding approvals rule" (SCW 2019).
///
///         Invariant: `budget == totalWeight`. Every unit of budget is one unit
///         of voting weight, so a project's support threshold is exactly its
///         cost. Weight that is never granted to a voter with a ballot is
///         "abstaining": it counts in the budget but never supports anything.
///
///         Ballots are `bytes` with one byte per project holding a competition
///         rank (1 + number of strictly preferred projects; ties share a value;
///         0 = unranked, i.e. the last tier).
abstract contract PBEAR {
    // ---------------------------------------------------------------- errors

    error ZeroCost();
    error TooManyProjects();
    error NoProjects();
    error InvalidBallot();
    error WeightExceedsTotal();
    error InsufficientWeight();
    error TallyAlreadyStarted();
    error TallyNotStarted();
    error TallyAlreadyDone();

    // ---------------------------------------------------------------- events

    event TallyStarted(uint256 budget);
    event RankAdvanced(uint256 rankLevel);
    event ProjectFunded(uint256 indexed projectId, uint256 support, uint256 rankLevel);
    event TallyDone(uint256 spent);

    // --------------------------------------------------------------- storage

    uint256 internal constant MAX_PROJECTS = 255;

    uint256[] internal _costs;
    address[] internal _voters;
    mapping(address => bool) internal _isVoter;
    mapping(address => uint256) internal _weight;
    mapping(address => bytes) internal _ballot;
    mapping(address => uint8) internal _defaultRank;

    /// @notice Sum of all weight ever deposited. Equals `budget` once the tally starts.
    uint256 public totalWeight;
    /// @dev Sum of weight granted to voters (not reduced by tally deductions).
    uint256 internal _grantedWeight;

    uint256 public budget;
    uint256 public rankLevel;
    uint256 public spent;
    mapping(uint256 => bool) public funded;
    uint256[] internal _fundedOrder;
    bool public tallyStarted;
    bool public tallyDone;

    // ------------------------------------------------------------- modifiers

    modifier beforeTally() {
        if (tallyStarted) revert TallyAlreadyStarted();
        _;
    }

    // ----------------------------------------------------------------- views

    function projectCount() public view returns (uint256) {
        return _costs.length;
    }

    function cost(uint256 projectId) public view returns (uint256) {
        return _costs[projectId];
    }

    function voterCount() public view returns (uint256) {
        return _voters.length;
    }

    function voterAt(uint256 index) public view returns (address) {
        return _voters[index];
    }

    function weightOf(address voter) public view returns (uint256) {
        return _weight[voter];
    }

    function ballotOf(address voter) public view returns (bytes memory) {
        return _ballot[voter];
    }

    /// @notice Weight that is in the budget but not granted to any voter.
    function abstainingWeight() public view returns (uint256) {
        return totalWeight - _grantedWeight;
    }

    /// @notice Rank used by the tally: the stored rank, or the last tier if unranked.
    ///         Reverts for a voter without a ballot.
    function effectiveRank(address voter, uint256 projectId) public view returns (uint8) {
        bytes storage ballot = _ballot[voter];
        if (ballot.length == 0) revert InvalidBallot();
        uint8 rank = uint8(ballot[projectId]);
        return rank == 0 ? _defaultRank[voter] : rank;
    }

    function fundedProjects() public view returns (uint256[] memory) {
        return _fundedOrder;
    }

    /// @notice True when no unfunded project fits in the remaining budget.
    function isExhausted() public view returns (bool) {
        return _isExhausted();
    }

    // ------------------------------------------------------------- internals

    function _addProject(uint256 cost_) internal beforeTally returns (uint256 id) {
        if (cost_ == 0) revert ZeroCost();
        if (_costs.length >= MAX_PROJECTS) revert TooManyProjects();
        id = _costs.length;
        _costs.push(cost_);
    }

    function _increaseTotalWeight(uint256 amount) internal beforeTally {
        totalWeight += amount;
    }

    function _grantWeight(address voter, uint256 amount) internal beforeTally {
        if (_grantedWeight + amount > totalWeight) revert WeightExceedsTotal();
        _registerVoter(voter);
        _weight[voter] += amount;
        _grantedWeight += amount;
    }

    function _revokeWeight(address voter, uint256 amount) internal beforeTally {
        if (_weight[voter] < amount) revert InsufficientWeight();
        _weight[voter] -= amount;
        _grantedWeight -= amount;
    }

    function _setBallot(address voter, bytes calldata ranks) internal beforeTally {
        uint256 m = _costs.length;
        if (ranks.length != m) revert InvalidBallot();

        // Competition ranking check: a rank value r may only be used if exactly
        // r - 1 projects carry a smaller non-zero rank.
        uint256[] memory counts = new uint256[](m + 1);
        for (uint256 c = 0; c < m; c++) {
            uint8 r = uint8(ranks[c]);
            if (r > m) revert InvalidBallot();
            counts[r]++;
        }
        uint256 seen = 0;
        for (uint256 r = 1; r <= m; r++) {
            if (counts[r] != 0 && r != seen + 1) revert InvalidBallot();
            seen += counts[r];
        }

        _registerVoter(voter);
        _ballot[voter] = ranks;
        _defaultRank[voter] = uint8(seen + 1);
    }

    function _startTally() internal beforeTally {
        if (_costs.length == 0) revert NoProjects();
        tallyStarted = true;
        budget = totalWeight;
        rankLevel = 1;
        emit TallyStarted(budget);
        if (_isExhausted()) {
            tallyDone = true;
            emit TallyDone(spent);
        }
    }

    function _registerVoter(address voter) private {
        if (!_isVoter[voter]) {
            _isVoter[voter] = true;
            _voters.push(voter);
        }
    }

    function _isExhausted() internal view returns (bool) {
        uint256 remaining = budget - spent;
        uint256 m = _costs.length;
        for (uint256 c = 0; c < m; c++) {
            if (!funded[c] && _costs[c] <= remaining) return false;
        }
        return true;
    }
}
