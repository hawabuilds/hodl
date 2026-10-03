// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {HodlRouter} from "../src/HodlRouter.sol";
import {FeeCollector} from "../src/FeeCollector.sol";

/// Deploy FeeCollector v2 then HodlRouter v2 — paused, maxNotionalUsd = $100.
///
/// Signs with an encrypted Foundry keystore; this script never reads a key.
///
///   cast wallet import hodl-deployer --interactive        # once
///   forge script script/Deploy.s.sol --rpc-url <4663 RPC> --account hodl-deployer             # dry run
///   forge script script/Deploy.s.sol --rpc-url <4663 RPC> --account hodl-deployer --broadcast # deploy
///
/// The deployer becomes owner of both contracts. Move ownership to the Safe
/// with transferOwnership(safe) then acceptOwnership() from the Safe. This
/// script never unpauses and never changes the fee or cap.
contract Deploy is Script {
    address constant UR = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address constant SR02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH_USDG = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    uint256 constant CAP_USD = 100;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain 4663");

        vm.startBroadcast();
        (, address owner,) = vm.readCallers();
        require(owner != DEFAULT_SENDER, "pass --account hodl-deployer");

        FeeCollector collector = new FeeCollector(owner);
        HodlRouter router =
            new HodlRouter(address(collector), UR, SR02, WETH, USDG, WETH_USDG, CAP_USD, owner);

        vm.stopBroadcast();

        require(router.paused(), "must deploy paused");
        require(router.maxNotionalUsd() == CAP_USD, "cap must be 100");
        require(router.feeBps() == 50, "fee must be 50");
        require(router.feeCollector() == address(collector), "collector");
        require(collector.owner() == owner && router.owner() == owner, "owner");
        require(router.pendingOwner() == address(0) && collector.pendingOwner() == address(0));

        console2.log("== Deployer / owner      ", owner);
        console2.log("== FeeCollector          ", address(collector));
        console2.log("     owner               ", collector.owner());
        console2.log("== HodlRouter            ", address(router));
        console2.log("   constructor args:");
        console2.log("     feeCollector        ", router.feeCollector());
        console2.log("     universalRouter     ", router.universalRouter());
        console2.log("     swapRouter02        ", router.swapRouter02());
        console2.log("     WETH                ", router.WETH());
        console2.log("     USDG                ", router.USDG());
        console2.log("     wethUsdgPool (TWAP) ", router.wethUsdgPool());
        console2.log("     maxNotionalUsd      ", router.maxNotionalUsd());
        console2.log("     owner               ", router.owner());
        console2.log("   fixed in bytecode:");
        console2.log("     PONS_HOOK           ", router.PONS_HOOK());
        console2.log("     LONG_HOOK           ", router.LONG_HOOK());
        console2.log("     feeBps              ", router.feeBps());
        console2.log("     MAX_FEE_BPS         ", router.MAX_FEE_BPS());
        console2.log("     TIMELOCK (s)        ", router.TIMELOCK());
        console2.log("     TWAP_WINDOW (s)     ", router.TWAP_WINDOW());
        console2.log("     paused              ", router.paused());
        console2.log("   live check: $ value of 1 ETH (6 dp)", router.quoteUsdg(1 ether));
    }
}
