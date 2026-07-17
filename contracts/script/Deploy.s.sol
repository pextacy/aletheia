// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AletheiaRegistry} from "../src/AletheiaRegistry.sol";

/// @notice Deploys AletheiaRegistry and records the address in
///         deployments/<chainId>.json. Asserts the target chain ID from the
///         CHAIN_ID env var before broadcasting — never deploy blind.
contract Deploy is Script {
    function run() external {
        uint256 expectedChainId = vm.envUint("CHAIN_ID");
        require(block.chainid == expectedChainId, "wrong chain: block.chainid != CHAIN_ID env");

        vm.startBroadcast();
        AletheiaRegistry registry = new AletheiaRegistry();
        vm.stopBroadcast();

        console.log("AletheiaRegistry deployed at", address(registry));
        console.log("chain id", block.chainid);

        string memory json = vm.serializeAddress("deployment", "registry", address(registry));
        json = vm.serializeUint("deployment", "chainId", block.chainid);
        vm.writeJson(json, string.concat("../deployments/", vm.toString(block.chainid), ".json"));
    }
}
