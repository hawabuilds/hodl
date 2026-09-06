// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {HodlRouter} from "../src/HodlRouter.sol";
import {FeeCollector} from "../src/FeeCollector.sol";

/// Deploy FeeCollector then HodlRouter — paused, maxNotionalUsd = $100.
///
/// Do not broadcast until you have approved a deployer key. This script
/// never unpauses and never raises the cap.
///
///   cd contracts
///   forge script script/Deploy.s.sol --rpc-url $ALCHEMY_RPC_URL --broadcast --verify
///
/// Required env (not printed by this repo): PRIVATE_KEY
contract Deploy is Script {
    address constant UR = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant SR02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH_USDG = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(pk);
        vm.startBroadcast(pk);

        FeeCollector collector = new FeeCollector(owner);
        HodlRouter router = new HodlRouter(
            address(collector),
            UR,
            SR02,
            WETH,
            USDG,
            WETH_USDG,
            100,
            owner
        );

        vm.stopBroadcast();

        require(router.paused(), "must deploy paused");
        require(router.maxNotionalUsd() == 100, "cap must be 100");
        require(router.feeBps() == 50, "fee must be 50");

        console2.log("FeeCollector", address(collector));
        console2.log("HodlRouter", address(router));
    }
}
