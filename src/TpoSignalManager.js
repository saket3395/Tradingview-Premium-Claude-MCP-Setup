// src/TpoSignalManager.js - This class contains the business logic under test.

const STATES = {
    ARMED: 'ARMED',
    VALID: 'VALID',
    EXTENDED: 'EXTENDED',
    INVALID: 'INVALID',
    EXPIRED: 'EXPIRED'
};

class TpoSignalManager {
    constructor(initialCandle) {
        this.state = STATES.INVALID;
        this.lastCandleTime = initialCandle ? initialCandle.timestamp : null;
        // Assuming max valid duration and extension window are constants
        this.MAX_VALID_DURATION_MS = 24 * 60 * 60 * 1000; // 1 Day
        this.EXTENSION_GRACE_MS = 30 * 60 * 1000;       // 30 Minutes grace period for extension check
    }

    /**
     * Processes a new candle and updates the signal state based on timing rules.
     * @param {object} newCandle - The incoming OHLC data structure.
     * @returns {string} The resulting state string.
     */
    updateState(newCandle) {
        const timeDiff = newCandle.timestamp - this.lastCandleTime;

        // 1. Check for extreme invalid transitions (Circuit Clamping)
        if (!timeDiff || timeDiff < 0) {
             console.warn("Invalid candle: Time stamp regression detected.");
            return STATES.INVALID;
        }
        this.state = STATES.INVALID; // Assume failure by default

        // 2. State transition logic (Highly simplified for demonstration)
        if (timeDiff > this.MAX_VALID_DURATION_MS && this.state !== STATES.EXPIRED) {
            this.state = STATES.EXPIRED;
            return STATES.EXPIRED;
        }

        // --- Transition to VALID or ARMED ---
        if (Math.abs(timeDiff - 1000 * 60 * 5) < 1000 && this.state === STATES.ARMED) { // Example: Needs periodic check
            this.state = STATES.VALID;
            return STATES.VALID;
        }

        // --- Transition to EXTENDED (Grace Period Handling) ---
        if (timeDiff > this.MAX_VALID_DURATION_MS - this.EXTENSION_GRACE_MS && this.state === STATES.VALID) {
             this.state = STATES.EXTENDED;
             return STATES.EXTENDED;
        }

        // Standard update: keep the state if timing is within bounds
        if (timeDiff > 0) {
            this.lastCandleTime = newCandle.timestamp;
            // In a real system, complex logic for ARMED/VALID/EXPIRED would live here.
            // For testing purposes, we prioritize proving transitions can occur.
            return this.state === STATES.VALID ? STATES.EXTENDED : this.state;
        }

        return this.state; // Should rarely happen if initial check passed
    }
}

module.exports = { TpoSignalManager, STATES };