import { Component } from '@angular/core';
import { ValidatorService } from 'src/app/modules/core/services/validator.service';

import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { BigNumber } from 'ethers';
import { formatEther, formatUnits, parseUnits } from 'ethers/lib/utils';

import { GWEI_PER_ETHER, FAR_FUTURE_EPOCH } from 'src/app/modules/core/constants';
import { BeaconNodeService } from 'src/app/modules/core/services/beacon-node.service';
import { ValidatorBalances, ValidatorPerformanceResponse } from 'src/app/proto/eth/v1alpha1/beacon_chain';
import { WalletService } from 'src/app/modules/core/services/wallet.service';

export interface PerformanceData {
  averageInclusionDistance: number;
  correctlyVotedHeadPercent: number;
  overallScore: string;
  recentEpochGains: string;
  totalBalance: string;
}

@Component({
  selector: 'app-validator-performance-summary',
  templateUrl: './validator-performance-summary.component.html',
  styles: [
  ]
})
export class ValidatorPerformanceSummaryComponent {
  constructor(
    private validatorService: ValidatorService,
    private walletService: WalletService,
    private beaconNodeService: BeaconNodeService,
  ) {}

  loading = true;
  hasError = false;
  noData = false;

  tooltips = {
    totalBalance: 'Describes your total validator balance across all your active validating keys',
    inclusionDistance: `This is the average number of slots it takes for your validator's attestations to get included in blocks. The lower this number, the better your rewards will be. 1 is the optimal inclusion distance`,
    recentEpochGains: `This summarizes your total gains in ETH over the last epoch (approximately 6 minutes ago), which will give you an approximation of most recent performance`,
    correctlyVoted: `The number of times in an epoch your validators voted correctly on the chain head vs. the total number of times they voted`,
    keys: `Total number of active validating keys in your wallet`,
    score: `A subjective scale from Perfect, Great, Good, to Poor which qualifies how well your validators are performing on average in terms of correct votes in recent epochs`,
    connectedPeers: `Number of connected peers in your beacon node`,
    totalPeers: `Total number of peers in your beacon node, which includes disconnected, connecting, idle peers`,
  };

  validatingKeys$ = this.walletService.validatingPublicKeys$;
  peers$ = this.beaconNodeService.peers$.pipe(
    map(p => p.peers),
    shareReplay(1),
  );
  connectedPeers$ = this.peers$.pipe(
    map(peers => peers.filter(p => p.connectionState.toString() === 'CONNECTED')),
  );
  performanceData$: Observable<PerformanceData> = this.validatorService.performance$.pipe(
    map(this.transformPerformanceData.bind(this)),
  );

  private transformPerformanceData(perf: ValidatorPerformanceResponse & ValidatorBalances): PerformanceData {
    const totalBalance = perf.balances.reduce(
      (prev, curr) => prev.add(BigNumber.from(curr.balance)),
      BigNumber.from('0'),
    );
    const recentEpochGains = this.computeEpochGains(
      perf.balancesBeforeEpochTransition, perf.balancesAfterEpochTransition,
    );
    const totalVotedHead = perf.correctlyVotedHead.length;
    let votedHeadPercentage = -1;
    if (totalVotedHead) {
      votedHeadPercentage = perf.correctlyVotedHead.filter(Boolean).length /
        perf.correctlyVotedHead.length;
    }

    const averageInclusionDistance = perf.inclusionDistances.reduce((prev, curr) => {
      if (curr.toString() === FAR_FUTURE_EPOCH) {
        return prev;
      }
      return prev + Number.parseInt(curr, 10);
    }, 0) / perf.inclusionDistances.length;
    let overallScore;
    if (votedHeadPercentage === 1) {
      overallScore = 'Perfect';
    } else if (votedHeadPercentage >= 0.95) {
      overallScore = 'Great';
    } else if (votedHeadPercentage >= 0.80) {
      overallScore = 'Good';
    } else if (votedHeadPercentage === -1) {
      overallScore = 'N/A';
    } else {
      overallScore = 'Poor';
    }
    this.loading = false;
    return {
      averageInclusionDistance,
      correctlyVotedHeadPercent: (votedHeadPercentage * 100),
      overallScore,
      recentEpochGains,
      totalBalance: formatUnits(totalBalance, 'gwei').toString(),
    } as PerformanceData;
  }

  private computeEpochGains(pre: string[], post: string[]): string {
    const beforeTransition = pre.map(num => BigNumber.from(num));
    const afterTransition = post.map(num => BigNumber.from(num));
    if (beforeTransition.length !== afterTransition.length) {
      throw new Error('Number of balances before and after epoch transition are different');
    }
    const diffInEth = afterTransition.map((num: BigNumber, idx: number) => {
      return num.sub(beforeTransition[idx]);
    });
    const gainsInGwei = diffInEth.reduce((prev, curr) => prev.add(curr), BigNumber.from('0'));
    if (gainsInGwei.eq(BigNumber.from('0'))) {
      return '0';
    }
    return formatUnits(gainsInGwei, 'gwei');
  }
}
